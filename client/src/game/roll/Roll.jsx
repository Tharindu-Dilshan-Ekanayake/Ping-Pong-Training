import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from 'three'

import { ROLL_RECOVERY, TROPHY_FIRST, TROPHY_SPACING } from '@shared/balance'
import { formatNumber } from '@shared/format'
import { trophyValue, winsMultiplier, zoneIndexAt } from '@shared/logic'
import { mulberry32 } from '@shared/rng'

import { sfx } from '../../audio/sfx'
import { burst } from '../fx/fxQueue'
import { getGame, useGame } from '../../store/game'
import { getQuality, useQuality } from '../../store/quality'
import { iconUrl } from '../../ui/icons'
import { createToyInstances, PropBuilder } from '../blocks'
import { spawnScattered } from '../fx/popups'
import { sharedMaterials, STYLE } from '../materials'
import { runtime } from '../runtime'
import { activeWorld, perWorld, showLobbySky, zones } from '../worldLook'
import { createBallMesh, disposeBallMesh } from '../ball'
import { KICK_IMPACT } from '../playerPose'
import { BALL_SIZE, leapAt, RALLY_BALL_SIZE } from '../pong'
import { tireGlow } from '../tire'
import { writeDistance, writeSpeed, writeZone } from './hudLink'
import FireBurst from '../fx/FireBurst'
import Impact from './Impact'
import Lane from './Lane'
import { createRideState, floorY, meterAtZ, rideState, rideTurn, trackPoint, zAt } from './path'
import RollFX from './RollFX'
import { linkPrograms } from '../linkPrograms'
import { advanceRoll, roll } from './rollControl'
import SpeedBlur from './SpeedBlur'
import TireTrail from './TireTrail'
import { ZONE_THEMES } from './themes'
import Weather from './Weather'

const MAX_TROPHIES = 16
const STREAKS = 36
/** Trophies float this high over the rolling line. */
const TROPHY_HEIGHT = 3.4
/** Other players' balls drawn at once, besides yours. */
const MAX_GHOSTS = 7
/** Each other player's ball keeps to its own line down the lane, so balls don't overlap. */
const ghostLane = (sid) => {
  let h = 2166136261
  for (let i = 0; i < sid.length; i += 1) h = Math.imul(h ^ sid.charCodeAt(i), 16777619)
  return (((h >>> 0) % 5) - 2) * 3
}
/**
 * Frame-loop priority: before every other system, so the chase camera has moved before
 * anything projects into it (name tags, popups). Negative, so R3F still renders itself.
 */
const BEFORE_EVERYTHING = -1

const _m = new Matrix4()
const _q = new Quaternion()
const _p = new Vector3()
const _s = new Vector3()
const _v = new Vector3()
const _look = new Vector3()
const _cam = new Vector3()
/** The chase camera's smoothed position, before any shake is added on top. */
const camBase = new Vector3()
const _up = new Vector3(0, 1, 0)
/** Stable vector for runtime.flightFocus (the scratch ones are reused mid-frame). */
const tireFocus = new Vector3()
const _turn = new Quaternion()

/** The chase camera's field of view widens with speed, up to this much more. */
const FOV_KICK = 16
/** Shake at full speed, and the jolt of a landing (metres), fading over LAND_SHAKE_MS. */
const SPEED_SHAKE = 0.05
const LAND_SHAKE = 0.85
const LAND_SHAKE_MS = 220

/** At most one trophy popup this often; the trophies in between are summed into it. */
const TROPHY_POPUP_MS = 180
const TROPHY_ICON = iconUrl('trophy')
/** Trophy popups are scattered over the screen (see spawnScattered), a touch bigger than gains. */
const TROPHY_POPUP = { iconUrl: TROPHY_ICON, scale: 1.2 }

/**
 * Speed-line streaks, made once: alternately down the left and right of the view (well
 * clear of the tire and the distance counter), each a little thicker or longer than
 * the next, and every third tinted with your tire's glow.
 */
const streakState = (() => {
  const r = mulberry32(5)
  return Array.from({ length: STREAKS }, (_, i) => ({
    a: (i % 2 ? 0 : Math.PI) + (r() - 0.5) * 1.6,
    r: 2.8 + r() * 4,
    z: -r() * 30,
    width: 0.06 + r() * 0.06,
    length: 0.7 + r() * 0.6,
    tinted: i % 3 === 0,
  }))
})()
/** Speed lines fade in between these speeds (m/s). */
const STREAKS_FROM = 20
const STREAKS_FULL = 70
const WHITE = new Color('#ffffff')
const _tint = new Color()

/**
 * A speed line: two crossed quads, so it's thin from any angle. uv.x runs across it,
 * uv.y along it, from the tail (0) to the head (1, the end it travels towards).
 */
function createStreakGeometry() {
  const geometry = new BufferGeometry()
  const positions = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5]
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  return geometry
}

const streakVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;
  varying vec3 vColor;
  void main() {
    vUv = uv;
    vColor = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #endif
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`

const streakFragmentShader = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vDepth;
  varying vec3 vColor;
  void main() {
    // Soft-edged across; a long tail fading out behind a bright, rounded head.
    float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float along = smoothstep(0.0, 0.75, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
    // Gone before it reaches the lens (no fat bars across the screen), and faint far off.
    float depth = smoothstep(1.5, 6.0, vDepth) * (1.0 - smoothstep(24.0, 34.0, vDepth));
    gl_FragColor = vec4(vColor, across * across * along * depth * uOpacity);
    #include <colorspace_fragment>
  }
`

const zoneNameGradients = perWorld((zs) =>
  zs.map((z) => {
    const [a, b, c] = ZONE_THEMES[z.theme].name
    return `linear-gradient(180deg, ${a} 0%, ${b} 45%, ${c} 100%)`
  }),
)
/** Sideways, in metres, the camera starts for the kick (and swings back from). */
const KICK_CAM_SIDE = 4.4
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function createTrophyGeometry() {
  const p = new PropBuilder()
  const gold = '#ffcc1f'
  p.add(new CylinderGeometry(0.42, 0.24, 0.62, 12), { position: [0, 0.55, 0], color: gold, style: STYLE.GLOW })
  p.add(new TorusGeometry(0.2, 0.06, 6, 10, Math.PI), { position: [-0.42, 0.62, 0], rotation: [0, 0, Math.PI / 2], color: gold })
  p.add(new TorusGeometry(0.2, 0.06, 6, 10, Math.PI), { position: [0.42, 0.62, 0], rotation: [0, 0, -Math.PI / 2], color: gold })
  p.add(new CylinderGeometry(0.08, 0.08, 0.3, 6), { position: [0, 0.12, 0], color: gold })
  p.box(0, -0.05, 0, 0.5, 0.14, 0.5, '#ffb01e', STYLE.SMOOTH)
  return p.build()
}

/** Ride states for other players' tires: a fixed pool, handed out by session id. */
const ghostPool = Array.from({ length: MAX_GHOSTS }, () => ({ ...createRideState(), sid: null, ride: null }))

/** The pooled state replaying `ride` for player `sid`, or null if the pool is full. */
function ghostState(sid, ride) {
  let free = null
  for (const st of ghostPool) {
    if (st.sid === sid) {
      if (st.ride !== ride) {
        // A new roll from the same player.
        st.ride = ride
        ride.fromMeter = meterAtZ(ride.z)
        ride.startX = ride.x
      }
      return st
    }
    if (!free && st.sid === null) free = st
  }
  if (!free) return null
  free.sid = sid
  free.ride = ride
  ride.fromMeter = meterAtZ(ride.z)
  ride.startX = ride.x
  return free
}

/** Frees the pooled state of rolls that are over or whose player left. */
function releaseGhosts() {
  for (const st of ghostPool) {
    if (st.sid !== null && runtime.ghostRolls.get(st.sid) !== st.ride) {
      st.sid = null
      st.ride = null
    }
  }
}

/**
 * Squash and stretch for your ball, like a cartoon: flattened for a moment when it lands
 * off a ramp or bursts through a wall, then springing back with a wobble. `squash` is
 * the amount (0 = none); the tire spreads sideways as it flattens.
 */
const _squash = new Matrix4()
const _toCentre = new Matrix4()
function applySquash(m, at, squash) {
  if (squash < 0.002) return m
  _squash.makeScale(1 + squash * 0.6, 1 - squash, 1 + squash * 0.6)
  _toCentre.makeTranslation(-at.x, -at.y, -at.z)
  m.premultiply(_toCentre).premultiply(_squash)
  return m.premultiply(_toCentre.makeTranslation(at.x, at.y, at.z))
}

/**
 * How squashed your tire is now: a landing, a wall hit or the kick, springing back over
 * ~0.35 s.
 */
function tireSquash(now) {
  const since = now - Math.max(roll.landedAt, roll.hitAt, roll.kickedAt)
  if (since < 0 || since > 350) return 0
  // A quick flatten, then a little overshoot - a bouncy toy, not a stiff wheel.
  return 0.28 * Math.exp(-since / 90) * Math.cos(since / 55)
}


/** How high the ball tosses for a serve, and where: ahead and to the right of the server. */
const TOSS_HEIGHT = 1.3
const TOSS_AHEAD = 0.85
const TOSS_RIGHT = 0.5

/**
 * Writes ball instance `n` for ride state `st` of `ride` (yours, or a ghost's), in paddle
 * `id`'s colour. Before the hit it's the serve's toss beside the player; then it flies
 * off the paddle in a high arc down the lane and bounces to a stop (path.rideState),
 * spinning as it goes. Returns the next free instance.
 */
function placeBall(balls, n, st, ride, id, squash = 0) {
  let size
  if (st.phase === 'launch') {
    // Up off the free hand and back down to the paddle as it swings (facing -z).
    const toss = Math.sin(Math.PI * st.launch)
    // Tossed higher for a jump smash, to meet the paddle up in the air.
    const leap = leapAt(ride.hit, st.launch * KICK_IMPACT)
    _p.set(ride.startX + TOSS_RIGHT, floorY(ride.fromMeter) + 1.25 + TOSS_HEIGHT * toss + leap, zAt(ride.fromMeter) - TOSS_AHEAD)
    _turn.identity()
    size = RALLY_BALL_SIZE * 1.3
  } else {
    _p.copy(st.position)
    rideTurn(st, _turn)
    // Swelling from the tossed ball to full size as it leaves the paddle: a power shot.
    size = BALL_SIZE * Math.min(1, 0.2 + (st.meter - ride.fromMeter) / 5)
  }
  _m.compose(_p, _turn, _s.setScalar(size))
  applySquash(_m, _p, squash)
  balls.setMatrixAt(n, _m)
  // Dressed as its paddle's ball; yours burns after a PERFECT hit.
  balls.setBall(n, id, n === 0 && roll.hit === 'perfect')
  return n + 1
}

/**
 * Lazily loaded: the track, its walls and trophies, your rolling tire (and other
 * players' ghost tires) and the chase camera while it rolls. While nobody is rolling it
 * still streams the first stretch, which is the canyon you see from the lobby.
 */
export default function Roll() {
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const rootRef = useRef(null)
  const trophyRef = useRef(null)
  const tiresRef = useRef(null)
  const streakRef = useRef(null)
  /** The roll (its startedAt) the speed lines were last tinted for. */
  const streakTintedFor = useRef(-1)
  const startedFor = useRef(0)
  /** Trophies passed so far this roll: the next one's metre, and Wins not yet shown. */
  const trophyTally = useRef({ next: TROPHY_FIRST, pending: 0, shownAt: 0 })
  const zoneShown = useRef(-1)
  const wasActive = useRef(false)
  /** The camera's field of view outside rolls, restored after each. */
  const baseFov = useRef(60)
  const speedLines = useQuality((s) => s.settings.speedLines)
  const motionBlur = useQuality((s) => s.settings.motionBlur)
  const antialias = useQuality((s) => s.antialias)
  const rolling = useGame((s) => Boolean(s.roll))

  const assets = useMemo(() => {
    const trophies = createToyInstances(createTrophyGeometry(), sharedMaterials().toy, MAX_TROPHIES)
    // Yours (instance 0) and everyone else's: one ball mesh.
    const tires = createBallMesh(1 + MAX_GHOSTS)

    const streakMaterial = new ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: streakVertexShader,
      fragmentShader: streakFragmentShader,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    })
    const streakMesh = new InstancedMesh(createStreakGeometry(), streakMaterial, STREAKS)
    // Colours exist from the start, so the shader is compiled with them once.
    for (let i = 0; i < STREAKS; i += 1) streakMesh.setColorAt(i, WHITE)
    streakMesh.frustumCulled = false
    streakMesh.count = 0

    return { trophies, tires, streakMesh, streakMaterial }
  }, [])

  // This module loads after the lobby is on screen; compile its shaders in the
  // background before showing it, so the first roll doesn't stall on them.
  useEffect(() => {
    const root = rootRef.current
    // Skipped in dev, where StrictMode's remount disposes materials mid-compile (see
    // ShaderWarmup).
    if (!root || import.meta.env.DEV) return undefined
    let cancelled = false
    // compile() only gathers what's visible, and gathers it there and then: so it's
    // called with the root shown, and the root hidden straight after, until it's done.
    root.visible = true
    const compiling = gl.compileAsync(root, camera, scene)
    root.visible = false
    compiling
      .catch(() => null)
      .finally(() => {
        if (cancelled) return
        // Linked now, in the lobby, not at the first serve's paddle hit (linkPrograms.js).
        linkPrograms(gl)
        root.visible = true
      })
    return () => {
      cancelled = true
    }
  }, [gl, camera, scene])

  useEffect(
    () => () => {
      assets.trophies.geometry.dispose()
      assets.trophies.dispose()
      disposeBallMesh(assets.tires)
      assets.streakMesh.geometry.dispose()
      assets.streakMaterial.dispose()
      assets.streakMesh.dispose()
      showLobbySky(null)
    },
    [assets],
  )

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const settings = getQuality()
    const now = performance.now()

    // --- The roll -----------------------------------------------------------------
    let focus = 0
    let speed = 0
    if (roll.active) {
      advanceRoll(state.clock.elapsedTime)
      if (startedFor.current !== roll.startedAt) {
        startedFor.current = roll.startedAt
        camBase.copy(camera.position)
        baseFov.current = camera.fov
        const tally = trophyTally.current
        tally.next = TROPHY_FIRST
        tally.pending = 0
        tally.shownAt = 0
        zoneShown.current = -1
      }
      focus = Math.max(0, roll.meter)
      speed = roll.speed
      const p = roll.position
      runtime.flightFocus = tireFocus.copy(p)
      writeDistance(Math.max(0, roll.meter))
      const zi = zoneIndexAt(Math.max(0, roll.meter))
      if (zi !== zoneShown.current) {
        // Into a new stage (not the one it starts in): confetti round the tire and a
        // cheerful jingle.
        if (zoneShown.current >= 0 && zi > zoneShown.current) {
          sfx.stageUp()
          if (settings.particles) burst({ x: p.x, y: p.y + 2, z: p.z - 6, count: 44, palette: 'confetti', speed: 10 })
        }
        zoneShown.current = zi
        writeZone(zi, zones()[zi].name, zoneNameGradients()[zi])
      }

      // The sound of the roll, swelling with its speed, gone once it stops.
      // (Silent once it has slammed down: the boom and the hops take over.)
      if (roll.airborne && speed > 4) {
        sfx.windStart()
        sfx.windSet(speed / 120, roll.airborne, 0)
      } else if (roll.bounces > 0 || roll.stopped) {
        sfx.windStop()
      }

      if (runtime.camera.mode === 'roll') {
        // On the roll's own clock, so the camera freezes with the ball in slow motion.
        const elapsed = (now - roll.startedAt - roll.lag) / 1000
        if (roll.phase === 'stopped' || roll.crashed) {
          // Stopped: swing round to the side and in, onto the tire lying there.
          const k = smoothstep(0, 1.4, elapsed - roll.duration + (roll.crashed ? 0.5 : 0))
          const angle = (Math.floor(roll.distance) % 2 === 0 ? 1 : -1) * 0.7 * k
          const dist = 12 - 3.5 * k
          const height = 5.4 - 1.6 * k
          _cam.set(Math.sin(angle) * dist, height + Math.cos(angle) * dist * 0.15, Math.cos(angle) * dist).add(p)
          camBase.lerp(_cam, 1 - Math.exp(-4 * delta))
          _look.copy(p).y += 0.4
        } else {
          // Chase camera: behind and above the tire, looking down the track. Locked to it
          // along the lane (at hundreds of m/s any lag leaves it far behind);
          // eased sideways so the weaving stays smooth, and eased in from the lobby
          // camera - close for the push, pulling back once it's off.
          //
          // For the kick it starts close and to one side, looking at the player's foot
          // and the tire, so you see it; then it swings in behind and pulls back as the
          // tire goes.
          const off = smoothstep(0.55, 1.5, elapsed)
          const behind = 8 + 3.6 * off + Math.min(speed, 300) * 0.006
          trackPoint(roll.meter - behind, 0, 4.6 + 0.8 * off + roll.air, _cam)
          const easingIn = elapsed < 1.1
          const kIn = easingIn ? 1 - Math.exp(-8 * delta) : 1
          const kx = easingIn ? kIn : 1 - Math.exp(-5 * delta)
          camBase.set(
            camBase.x + (p.x * 0.7 + KICK_CAM_SIDE * (1 - off) - camBase.x) * kx,
            camBase.y + (_cam.y - camBase.y) * kIn,
            camBase.z + (_cam.z - camBase.z) * kIn,
          )
          trackPoint(roll.meter - 0.6 + 16.6 * off, p.x * 0.85, 1.7 + 0.3 * off + roll.air * 0.75, _look)
        }
        // Shake: a rumble that grows with speed, and a jolt on landings, wall hits and a
        // PERFECT hit's blast-off.
        const sinceLand = now - Math.max(roll.landedAt, roll.hitAt)
        // A graded hit's blast-off, as strong as the hit (roll.freezePower).
        const sinceBlast = roll.freezeAt ? now - roll.freezeAt - roll.freezeMs : -1
        const amp =
          (roll.phase === 'ride' && !roll.crashed ? Math.min(1, speed / 220) * SPEED_SHAKE : 0) +
          (sinceLand < LAND_SHAKE_MS * 3 ? LAND_SHAKE * Math.exp(-sinceLand / LAND_SHAKE_MS) : 0) +
          (sinceBlast >= 0 && sinceBlast < 700 ? 0.9 * roll.freezePower * Math.exp(-sinceBlast / 200) : 0)
        camera.position.set(camBase.x + (Math.random() - 0.5) * amp, camBase.y + (Math.random() - 0.5) * amp, camBase.z)
        camera.lookAt(_look)
        // The view widens with speed: the rush of going fast.
        // ...and punches wider for a moment on every wall smashed.
        const sinceHit = now - roll.hitAt
        const punch = !roll.crashed && sinceHit < 600 ? 7 * Math.exp(-sinceHit / 140) : 0
        // A good hit: the lens zooms in while time stands still, then punches wider as
        // the ball blasts off - quickly, not eased like the rest. All as strong as the hit.
        const sinceFreeze = roll.freezeAt ? now - roll.freezeAt : Infinity
        const perfect =
          sinceFreeze < roll.freezeMs
            ? -14 * roll.freezePower * smoothstep(0, 140, sinceFreeze)
            : sinceBlast >= 0 && sinceBlast < 1200
              ? 20 * roll.freezePower * Math.exp(-sinceBlast / 260)
              : 0
        const fov =
          baseFov.current +
          punch +
          perfect +
          (roll.phase === 'ride' && !roll.crashed ? Math.min(FOV_KICK, speed * 0.08) : roll.phase === 'stopped' ? -6 : 0)
        // (The frame's own camera handle: the same camera, but writable by lint's rules.)
        const lens = state.camera
        if (Math.abs(fov - lens.fov) > 0.05) {
          lens.fov += (fov - lens.fov) * (1 - Math.exp(-(perfect !== 0 ? 14 : 3) * delta))
          lens.updateProjectionMatrix()
        }
      }
    }
    if (wasActive.current && !roll.active) {
      state.camera.fov = baseFov.current
      state.camera.updateProjectionMatrix()
      sfx.windStop()
      showLobbySky(scene.fog)
    }
    wasActive.current = roll.active

    const ahead = settings.viewDistance

    // --- Your ball and everyone else's -------------------------------------------
    const tires = tiresRef.current
    if (tires) {
      let n = 0
      // Tossed up beside you, then hit; once it cracks on a gate it's only pieces
      // (Walls.jsx).
      if (roll.active && !roll.crashed) {
        n = placeBall(tires, n, roll, roll, roll.tireId, tireSquash(now))
      }
      for (const [sid, ride] of runtime.ghostRolls) {
        const elapsed = (now - ride.startedAt) / 1000
        if (elapsed > ride.duration + ROLL_RECOVERY + 2) {
          runtime.ghostRolls.delete(sid)
          continue
        }
        const st = ghostState(sid, ride)
        if (!st) continue
        rideState(elapsed, ride, ghostLane(sid), st)
        if (st.crashed || camera.position.distanceTo(st.position) > settings.viewDistance) continue
        n = placeBall(tires, n, st, ride, ride.tireId)
      }
      releaseGhosts()
      tires.count = n
      tires.instanceMatrix.needsUpdate = true
    }

    // --- Trophies -----------------------------------------------------------------
    if (roll.active) {
      // Tally the ones just rolled through. The Wins were granted with the roll; this is
      // the visual receipt. At speed you pass dozens a second, so they're summed into
      // one popup at most every TROPHY_POPUP_MS.
      const tally = trophyTally.current
      while (tally.next <= Math.min(roll.meter, roll.distance)) {
        tally.pending += trophyValue(tally.next, activeWorld())
        tally.next += TROPHY_SPACING
      }
      if (tally.pending > 0 && now - tally.shownAt >= TROPHY_POPUP_MS) {
        const multiplier = winsMultiplier(getGame().profile, Date.now())
        spawnScattered(`+${formatNumber(Math.round(tally.pending * multiplier))}`, TROPHY_POPUP)
        sfx.trophy()
        tally.pending = 0
        tally.shownAt = now
      }
    }
    const trophies = trophyRef.current
    if (trophies) {
      const spin = now * 0.003
      let count = 0
      const k0 = Math.max(0, Math.ceil((focus - 10 - TROPHY_FIRST) / TROPHY_SPACING))
      for (let m = TROPHY_FIRST + k0 * TROPHY_SPACING; m < focus + ahead * 0.8 && count < MAX_TROPHIES; m += TROPHY_SPACING) {
        if (roll.active && m <= roll.meter) continue
        trackPoint(m, 0, TROPHY_HEIGHT + Math.sin(spin + m) * 0.25, _p)
        _q.setFromAxisAngle(_up, spin + m)
        _s.setScalar(1.5)
        trophies.setMatrixAt(count, _m.compose(_p, _q, _s))
        count += 1
      }
      trophies.count = count
      trophies.instanceMatrix.needsUpdate = true
    }

    // --- Speed lines --------------------------------------------------------------
    // The streaking, blurred screen edges (HUD's SpeedTunnel) swell with speed too.
    writeSpeed(roll.active && !roll.stopped && !roll.crashed ? smoothstep(STREAKS_FROM, STREAKS_FULL * 1.5, speed) : 0, now)
    const lines = streakRef.current
    if (lines) {
      const active = roll.active && !roll.stopped && !roll.crashed && speedLines && speed > STREAKS_FROM
      if (!active) {
        lines.count = 0
      } else {
        if (streakTintedFor.current !== roll.startedAt) {
          // Once a roll: the tinted ones take this tire's glow, softened towards white.
          streakTintedFor.current = roll.startedAt
          _tint.copy(tireGlow(roll.tireId)).lerp(WHITE, 0.35)
          for (let i = 0; i < STREAKS; i += 1) lines.setColorAt(i, streakState[i].tinted ? _tint : WHITE)
          lines.instanceColor.needsUpdate = true
        }
        const fast = Math.min(speed, 400)
        lines.material.uniforms.uOpacity.value = smoothstep(STREAKS_FROM, STREAKS_FULL, speed)
        const travel = fast * delta * 0.6
        lines.count = STREAKS
        for (let i = 0; i < STREAKS; i += 1) {
          const st = streakState[i]
          st.z += travel
          if (st.z > 4) st.z -= 34
          // A wide oval: out to the sides more than up and down.
          _v.set(Math.cos(st.a) * st.r * 1.15, Math.sin(st.a) * st.r * 0.75, st.z - 4)
          _v.applyQuaternion(camera.quaternion).add(camera.position)
          _q.copy(camera.quaternion)
          _s.set(st.width, st.width, (2 + fast * 0.02) * st.length)
          lines.setMatrixAt(i, _m.compose(_v, _q, _s))
        }
        lines.instanceMatrix.needsUpdate = true
      }
    }
  }, BEFORE_EVERYTHING)

  return (
    <group ref={rootRef}>
      <Lane />
      <Impact />
      <FireBurst />
      <primitive ref={trophyRef} object={assets.trophies} />
      <primitive ref={tiresRef} object={assets.tires} />
      <Weather />
      <primitive ref={streakRef} object={assets.streakMesh} />
      <RollFX />
      <TireTrail />
      {rolling && motionBlur > 0 && <SpeedBlur samples={motionBlur} antialias={antialias} />}
    </group>
  )
}
