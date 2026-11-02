import { Euler, Quaternion, Vector3 } from 'three'

import { ROLL_LAUNCH } from '@shared/balance'
import { SLOPE_ANGLE, TRACK_START_Z } from '@shared/world'

import { KICK_IMPACT } from '../playerPose'
import { BALL_SIZE, leapAt } from '../pong'

/**
 * Geometry of the serve lane: one long, straight rainbow lane across an open field,
 * running north from the plaza's edge, dead level (SLOPE_ANGLE is 0; the maths still
 * allows a slope).
 *
 * Track metre `m` is measured along the track from the start line (the plaza's north
 * edge). Before the start (m < 0) the ground is the plaza. Everything here is pure
 * maths and allocation-free, so the frame loop can call it freely.
 */

export const SIN = Math.sin(SLOPE_ANGLE)
export const COS = Math.cos(SLOPE_ANGLE)
export const TAN = Math.tan(SLOPE_ANGLE)

/** World z of track metre m. */
export const zAt = (m) => TRACK_START_Z - (m > 0 ? m * COS : m)
/** Height of the floor at track metre m. */
export const floorY = (m) => (m > 0 ? -m * SIN : 0)
/** Height of the track's floor plane under world z. */
export const slopeY = (z) => (z < TRACK_START_Z ? -(TRACK_START_Z - z) * TAN : 0)
/** Height of a surface parallel to the floor, `h` metres off it, under world z. */
export const surfaceY = (z, h) => slopeY(z) + h / COS

/** How a box lies on the track: tipped back by the slope angle. */
export const SLOPE_EULER_X = -SLOPE_ANGLE

/** World point at track metre m, `x` to the side and `h` off the floor. */
export function trackPoint(m, x, h, out) {
  if (m <= 0) return out.set(x, h, TRACK_START_Z - m)
  return out.set(x, -m * SIN + h * COS, TRACK_START_Z - m * COS - h * SIN)
}

const _e = new Euler()
const _q = new Quaternion()
const _p = new Vector3()
const _s = new Vector3()

/**
 * Matrix of a box lying on the track, given in track terms: centred `x` across, `h`
 * off the floor (to its centre) and at metre `m` (also its centre), sized `sx` across,
 * `sy` thick and `sz` along the track, leaning `lean` radians about its own long axis.
 */
export function slopeBoxMatrix(m, x, h, sx, sy, sz, lean, out) {
  trackPoint(m, x, h, _p)
  _q.setFromEuler(_e.set(m > 0 ? SLOPE_EULER_X : 0, 0, lean))
  return out.compose(_p, _q, _s.set(sx, sy, sz))
}

/** Same as slopeBoxMatrix, but as BlockSet.add arguments: [x, y, z, rotX]. */
export function slopeBoxPlacement(m, x, h) {
  trackPoint(m, x, h, _p)
  return [_p.x, _p.y, _p.z, m > 0 ? SLOPE_EULER_X : 0]
}

/** Metres a world z is along the track (negative in the plaza). */
export const meterAtZ = (z) => (z < TRACK_START_Z ? (TRACK_START_Z - z) / COS : TRACK_START_Z - z)

// --- A serve ------------------------------------------------------------------------

/** Radius of a served ball in the world (pong.BALL_SIZE; named for the template's tire). */
export const TIRE_SIZE = BALL_SIZE

const clamp01 = (x) => Math.min(1, Math.max(0, x))

/**
 * The ball waits this far ahead of you when you hit it, and the flight sets off from
 * there.
 */
export const PUSH_AHEAD = 2.3
/**
 * Seconds into a serve that the paddle meets the ball: the player tosses it and swings
 * (playerPose.servePose, over ROLL_LAUNCH), and it stays in the toss until then. The
 * serve's total time is the authority's, so the flight runs from here.
 */
export const KICK_HIT = ROLL_LAUNCH * KICK_IMPACT

/**
 * The flight takes LAND_T of the serve's time after the hit; the rest is the ball
 * hopping in its crater and settling into it.
 */
const LAND_T = 0.84
/** Hops in the crater after it slams down, over the first SETTLE of the time left. */
const BOUNCES = 2
const SETTLE = 0.65
/** How deep the ball sits in its crater once it has settled. */
const SUNK = 0.3

/**
 * How far along its distance (0-1) the ball is `t` of the way through its flight: off
 * the paddle fast, slowing as it goes, and still moving as it slams down at the end.
 */
const progress = (t) => {
  const x = clamp01(t)
  return 1.5 * x - 0.5 * x * x
}

/**
 * Seconds into a serve of `duration` (launch included) at which the ball has flown `f`
 * (0-1) of its distance: 0.5 is the top of its arc, 1 the moment it slams down.
 */
export const serveTimeAt = (f, duration) => KICK_HIT + LAND_T * (1.5 - Math.sqrt(2.25 - 2 * clamp01(f))) * Math.max(0.1, duration - KICK_HIT)

/**
 * The flight: one high arc over the whole distance, slamming down exactly where the
 * authority says it stops - cracking the lane open (Impact.jsx) - then a couple of hops
 * in the crater and it settles into it. The arc's peak grows with the distance (a short
 * serve is a lob, a long one soars), capped so the lane stays in view below the ball.
 */
/** Height of the ball's bottom off the lane as it leaves the paddle (centre at chest height). */
const LAUNCH_AIR = 0.35
export const flightPeak = (distance) => Math.min(32, 4 + 0.6 * Math.sqrt(Math.max(0, distance)))

/** A fresh state for rideState to write into. */
export const createRideState = () => ({
  phase: 'launch',
  launch: 0,
  meter: 0,
  speed: 0,
  /** Height of the ball's bottom off the lane. */
  air: 0,
  /** True while the ball is in its arc (until it first lands). */
  airborne: false,
  /** 0 in the air; 1 once it has slammed down, then one more for every hop after. */
  bounces: 0,
  /** Turn about the ball's sideways axis (radians): its spin. */
  spin: 0,
  /** Template leftovers rideTurn still reads: always 0 for a ball. */
  lean: 0,
  topple: 0,
  yaw: 0,
  /** Never true: nothing on the lane stops a ball. */
  crashed: false,
  x: 0,
  position: new Vector3(),
})

/**
 * Everything about a served ball `elapsed` seconds into a serve - yours, or another
 * player's replayed from the same numbers, so both move identically. `ride` is
 * `{ fromMeter, startX, distance, duration }` (duration includes the launch); `lane` is
 * a sideways offset so balls don't overlap. Writes into `out` (see createRideState):
 *   phase    'launch' (tossed, the paddle swinging) | 'ride' | 'stopped'
 *   launch   0-1 through the launch
 *   meter    metres along the lane; speed in m/s along it
 *   air      height off the lane; airborne until it first lands
 *   position the ball's centre
 */
export function rideState(elapsed, ride, lane, out) {
  const start = ride.fromMeter + PUSH_AHEAD
  const end = Math.max(start + 1, ride.distance)
  const flightTime = Math.max(0.1, ride.duration - KICK_HIT)
  let meter = start
  let speed = 0
  let air
  out.airborne = false
  out.crashed = false
  out.bounces = 0
  if (elapsed < KICK_HIT) {
    out.phase = 'launch'
    out.launch = clamp01(elapsed / KICK_HIT)
    // Up with the player's jump smash, so the camera rises with them.
    air = LAUNCH_AIR + leapAt(ride.hit, out.launch * KICK_IMPACT)
  } else {
    const t = (elapsed - KICK_HIT) / flightTime
    out.launch = 1
    out.phase = t >= 1 ? 'stopped' : 'ride'
    const peak = flightPeak(end - start)
    if (t < LAND_T) {
      const f = progress(t / LAND_T)
      meter = start + (end - start) * f
      speed = ((end - start) * (1.5 - (t / LAND_T))) / (LAND_T * flightTime)
      // Off the paddle from as high as the jump smash took it.
      const lift = LAUNCH_AIR + leapAt(ride.hit, KICK_IMPACT)
      air = lift * (1 - f) + peak * 4 * f * (1 - f)
      out.airborne = true
    } else {
      // Down in its crater: BOUNCES hops, each lower, then it settles into the hole.
      meter = end
      const u = (t - LAND_T) / (1 - LAND_T) / SETTLE
      if (u < 1) {
        air = peak * 0.09 * (1 - u) * Math.abs(Math.sin(Math.PI * BOUNCES * u))
        out.bounces = 1 + Math.min(BOUNCES - 1, Math.floor(u * BOUNCES))
      } else {
        air = -SUNK * clamp01((u - 1) * 4)
        out.bounces = BOUNCES
      }
    }
  }
  // Ease from where it was hit onto its own line down the lane.
  const settle = clamp01((meter - start) / 40)
  const x = ride.startX * (1 - settle) + lane * settle
  out.meter = meter
  out.speed = speed
  out.air = air
  out.lean = 0
  out.topple = 0
  out.yaw = 0
  out.spin = -(meter - start) / TIRE_SIZE
  out.x = x
  trackPoint(meter, x, TIRE_SIZE + air, out.position)
  return out
}

const _ax = new Vector3(1, 0, 0)
const _ay = new Vector3(0, 1, 0)
const _az = new Vector3(0, 0, 1)
const _qa = new Quaternion()
const _qb = new Quaternion()
const _qc = new Quaternion()

/** The ball's turn for ride state `st`: its spin about its sideways axis. */
export function rideTurn(st, out) {
  // Turn about the vertical (Y), lean about the direction of travel (Z), then the spin
  // about X.
  _qc.setFromAxisAngle(_ay, st.yaw || 0)
  return out.multiplyQuaternions(_qc, _qa.setFromAxisAngle(_az, st.lean)).multiply(_qb.setFromAxisAngle(_ax, st.spin))
}
