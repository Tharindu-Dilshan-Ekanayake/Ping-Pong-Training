import { Vector3 } from 'three'

import { HIT_GRADES } from '@shared/balance'
import { formatNumber } from '@shared/format'
import { ROLL_RETURN } from '@shared/world'

import { sfx } from '../../audio/sfx'
import { getGame } from '../../store/game'
import { fadeThrough } from '../../ui/fade'
import { burst, fireBurst } from '../fx/fxQueue'
import { spawnScattered } from '../fx/popups'
import { runtime } from '../runtime'
import { zones } from '../worldLook'
import { showHit } from './hudLink'
import { createRideState, flightPeak, KICK_HIT, meterAtZ, PUSH_AHEAD, rideState, serveTimeAt } from './path'

/**
 * How long the "+N Wins" result shows over your stopped tire before you're back: long
 * enough to watch it wobble over onto its side (path.js, TOPPLE_TIME).
 */
const RESULT_HOLD_MS = 2600
/** The skid sound starts this long before a normal stop. */
const SKID_SOUND_LEAD = 0.9

/**
 * The roll currently playing, read every frame by the camera, the track, the walls and
 * the effects. Everything about it is known when it starts (the authority already
 * resolved the distance, the walls and the Wins), so the client just plays it back: no
 * per-frame network traffic.
 *
 * It's a ride state (see path.rideState: phase, launch, meter, air, spin, lean,
 * topple, position...) plus the roll's numbers. Your logical position stays on the
 * ROLL ZONE while the tire rolls (that's what the server checks); only the tire and the
 * camera go down the track.
 */
export const roll = {
  ...createRideState(),
  active: false,
  /** True once the tire has stopped and the result is showing. */
  stopped: false,
  startedAt: 0,
  distance: 0,
  duration: 1,
  wins: 0,
  prize: 0,
  discovered: [],
  /** Zone index of the wall that stopped it, or -1. */
  blocked: -1,
  /** How many stages it flies into past the first. */
  broken: 0,
  best: false,
  tireId: 'bicycle',
  /** How well the serve was timed (HIT_GRADES id), or null for Auto Serve. */
  hit: null,
  /** Where the roll started: metre along the track and how far to the side. */
  fromMeter: 0,
  startX: 0,
  /** performance.now() of the last landing, take-off and wall hit, for dust, shake and sound. */
  landedAt: 0,
  tookOffAt: 0,
  hitAt: 0,
  /** performance.now() when the kick landed and the tire set off. */
  kickedAt: 0,
  /**
   * A graded hit's hit-stop: when it started (performance.now(), 0 if none this serve),
   * how long it lasts, how strong the camera's zoom, punch and shake are (0-1), and the
   * roll clock's lag when it started (the freeze is measured from it).
   */
  freezeAt: 0,
  freezeMs: 0,
  freezePower: 0,
  freezeLag: 0,
  /**
   * The ball slamming down at the end of its arc: when (performance.now()), where, and
   * how high it fell from - what the crater and the flying chunks of lane need.
   */
  impactAt: 0,
  impact: new Vector3(),
  impactMeter: 0,
  impactPeak: 0,
  frameKey: -1,
  /**
   * Slow motion: ms the roll's clock is behind real time. Every wall smashed slows the
   * tire (and the camera on it) for a moment, so you see the planks burst; the clock
   * catches up again a little faster than real time afterwards, and is always caught up
   * before the tire stops, so the roll ends exactly when the authority said.
   */
  lag: 0,
  lastNow: 0,
}

/** How long each smash's slow motion lasts, how slow, and how fast the clock catches up. */
const SLOW_MS = 220
const SLOW_RATE = 0.25
/** How fast the roll's clock runs during a hit-stop: all but frozen. */
const FREEZE_RATE = 0.06
const CATCH_UP = 0.4

let timers = []

function clearTimers() {
  for (const id of timers) clearTimeout(id)
  timers = []
}

/**
 * Moves the roll on to this frame. Idempotent per frame (keyed on the renderer's
 * clock), so the camera, walls and effects all see exactly the same state however many
 * of them ask.
 */
export function advanceRoll(clockTime) {
  if (!roll.active || roll.frameKey === clockTime) return roll
  roll.frameKey = clockTime
  const now = performance.now()
  const wasAirborne = roll.airborne
  const wasCrashed = roll.crashed
  const wasWaiting = roll.phase === 'launch'
  const wasBounces = roll.bounces
  const dt = roll.lastNow ? Math.min(now - roll.lastNow, 100) : 0
  roll.lastNow = now
  if (now - roll.freezeAt < roll.freezeMs) {
    // From the clock, not summed frame by frame: frame steps are capped, so on a slow
    // device a summed freeze would mostly slip away.
    roll.lag = roll.freezeLag + (now - roll.freezeAt) * (1 - FREEZE_RATE)
  } else if (now - roll.hitAt < SLOW_MS && !roll.crashed) roll.lag += dt * (1 - SLOW_RATE)
  else roll.lag = Math.max(0, roll.lag - dt * CATCH_UP)
  // All caught up by half a second before the stop.
  const left = roll.duration - (now - roll.startedAt) / 1000
  roll.lag = Math.min(roll.lag, Math.max(0, left - 0.5) * 400)
  rideState((now - roll.startedAt - roll.lag) / 1000, roll, 0, roll)
  if (wasWaiting && roll.phase !== 'launch') {
    roll.kickedAt = now
    paddleHit(now)
  }
  if (!wasAirborne && roll.airborne) {
    roll.tookOffAt = now
    sfx.jumpWhoosh()
  } else if (wasAirborne && !roll.airborne) {
    // Slammed down from the top of its arc: the lane cracks open (Impact.jsx), the camera
    // jolts, a moment of slow motion, and a boom.
    roll.landedAt = now
    roll.hitAt = now
    roll.impactAt = now
    roll.impact.copy(roll.position)
    roll.impactMeter = roll.meter
    roll.impactPeak = flightPeak(roll.distance - roll.fromMeter - PUSH_AHEAD)
    sfx.groundSmash(Math.min(1, roll.impactPeak / 32))
  }
  // Each hop in the crater after it: a tok, softer every time.
  if (roll.bounces > wasBounces && wasBounces > 0) sfx.bounce(roll.bounces - 1)
  if (!wasCrashed && roll.crashed) {
    roll.hitAt = now
    sfx.wallBlock()
  }
  return roll
}

/**
 * How each grade of hit looks and sounds as the paddle meets the ball: its burst off the
 * paddle (FireBurst kind), confetti, how long time stands still and how hard the camera
 * reacts (0-1). The rest - the leap, the title - follows the grade too.
 */
const HIT_FX = {
  perfect: { fire: 'perfect', palette: 'gold', count: 60, speed: 12, freezeMs: 650, power: 1 },
  great: { fire: 'great', palette: 'power', count: 34, speed: 9, freezeMs: 320, power: 0.65 },
  good: { fire: 'good', palette: 'confetti', count: 16, speed: 6, freezeMs: 140, power: 0.35 },
  weak: { fire: null, palette: null, count: 0, speed: 0, freezeMs: 0, power: 0 },
}

/**
 * The paddle meeting the ball, up at the top of the jump smash (pong.leapAt): the grade
 * the timing meter gave it, straight away, so you see why it flies as far as it does.
 * GOOD, GREAT and PERFECT each get their own moment, bigger every step: time stands
 * still for a beat while a burst flies off the paddle - sparkles, an electric-blue
 * blast, a column of fire - and the grade's title slams onto the screen (HitFlash.jsx);
 * then the ball blasts away with the lens punching wide and the camera shaking
 * (Roll.jsx). A WEAK one just plops off the paddle.
 */
function paddleHit(now) {
  const grade = HIT_GRADES.find((g) => g.id === roll.hit)
  if (!grade) return
  const fx = HIT_FX[grade.id]
  const p = roll.position
  if (fx.count) burst({ x: p.x, y: p.y, z: p.z, count: fx.count, palette: fx.palette, speed: fx.speed })
  if (grade.id === 'weak') {
    spawnScattered(grade.label, { scale: 1.3 })
    sfx.weakHit()
    return
  }
  // The freeze starts the moment the paddle met the ball on the roll's clock, not at
  // whichever frame noticed: on a slow frame the ball would be well away by then.
  roll.freezeAt = Math.min(now, roll.startedAt + roll.lag + KICK_HIT * 1000)
  roll.freezeMs = fx.freezeMs
  roll.freezePower = fx.power
  roll.freezeLag = roll.lag
  fireBurst(p.x, p.y, p.z, fx.fire)
  showHit(grade.id)
  sfx.gradeHit(grade.id)
  timers.push(setTimeout(() => sfx.perfectRelease(fx.power), fx.freezeMs))
}

/** Starts a roll the authority already resolved: the tire pops out, then off it goes. */
export function beginRoll(result) {
  clearTimers()
  const game = getGame()
  const p = runtime.player.position
  Object.assign(roll, {
    active: true,
    stopped: false,
    startedAt: performance.now(),
    distance: result.distance,
    duration: result.duration,
    wins: result.wins,
    prize: result.prize || 0,
    discovered: result.discovered || [],
    blocked: result.blocked ?? -1,
    broken: result.broken || 0,
    best: result.best,
    tireId: result.tireId || game.profile.equippedTire,
    hit: result.hit ?? null,
    fromMeter: meterAtZ(p.z),
    startX: p.x,
    landedAt: 0,
    tookOffAt: 0,
    hitAt: 0,
    kickedAt: 0,
    freezeAt: 0,
    freezeMs: 0,
    freezePower: 0,
    impactAt: 0,
    frameKey: -1,
    lag: 0,
    lastNow: 0,
  })
  rideState(0, roll, 0, roll)
  runtime.player.frozen = true
  // Square up to the tire and the track, ready to kick it.
  runtime.player.yaw = Math.PI
  runtime.camera.mode = 'roll'
  game.startRoll({
    distance: result.distance,
    wins: result.wins,
    prize: result.prize || 0,
    blocked: result.blocked ?? -1,
    duration: result.duration,
    best: result.best,
  })

  // The wind-up's swish, then the foot meets the tire: a thump, and off it goes.
  sfx.kickSwing()
  timers.push(
    setTimeout(() => {
      sfx.kick()
      sfx.rollStart()
    }, KICK_HIT * 1000),
  )
  // A cartoon whistle as it falls from the top of its arc, ending as it slams down.
  const apex = serveTimeAt(0.5, result.duration)
  const land = serveTimeAt(1, result.duration)
  timers.push(setTimeout(() => sfx.fallWhistle(land - apex), apex * 1000))
  timers.push(setTimeout(() => sfx.rollStop(), Math.max(0, result.duration - SKID_SOUND_LEAD) * 1000))
  timers.push(
    setTimeout(() => {
      roll.stopped = true
      sfx.wins()
      const f = roll.position
      burst({ x: f.x, y: f.y + 1.8, z: f.z, count: 50, palette: 'gold', speed: 9 })
      game.endRoll()
      // A zone reached for the first time ever: its name and the prize, once.
      const stages = zones()
      for (const zi of roll.discovered) {
        game.showToast(`NEW ZONE: ${stages[zi].name}! +${formatNumber(stages[zi].discover)} Wins`)
      }
      timers.push(setTimeout(() => fadeThrough(finishRoll), RESULT_HOLD_MS))
    }, result.duration * 1000),
  )
}

/**
 * Back at the start, just short of the roll zone, camera behind you. With Auto Roll on
 * you stay on the zone instead, so the next roll goes straight away.
 */
export function finishRoll() {
  clearTimers()
  roll.active = false
  roll.stopped = false
  runtime.flightFocus = null
  const player = runtime.player
  const { passes, settings } = getGame().profile
  if (!(passes.autoRoll && settings.autoRoll)) player.position.set(ROLL_RETURN.x, 0, ROLL_RETURN.z)
  player.yaw = Math.PI
  player.frozen = false
  runtime.camera.mode = 'follow'
  runtime.camera.yaw = 0
  runtime.camera.snap = true
  getGame().clearRollResult()
}
