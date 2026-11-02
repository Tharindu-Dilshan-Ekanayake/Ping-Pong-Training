import { Quaternion, Vector3 } from 'three'

import { TRAIN_INTERVAL } from '@shared/balance'
import { padCenterZ, ROBOT_X, TABLE_HEIGHT, TABLE_LENGTH, TABLE_X } from '@shared/world'

/**
 * Ping pong bits shared by your character, everyone else's and the serve: the ball's
 * size, the rally at a training table, and how a paddle sits in the hand. (The ball
 * itself, dressed to match each paddle, is ball.js.)
 *
 * Paddles themselves are tire.js's meshes (the template's "tires": one geometry and
 * shader for all twenty-four, drawn as paddles) - see tireBaseGeometry there.
 */

// --- The ball -------------------------------------------------------------------------

/** A served ball's radius on the track: cartoon-big, so it reads at speed. */
export const BALL_SIZE = 0.9
/** The ball in a rally at a training table, and tossed up for a serve. */
export const RALLY_BALL_SIZE = 0.13


// --- The rally at a training table ----------------------------------------------------

/** Where in a rally's cycle (0-1) the paddle meets the ball: the start of it. */
export const rallyPhase = (time) => (time / TRAIN_INTERVAL) % 1

const TOP = TABLE_HEIGHT + RALLY_BALL_SIZE
/** The table runs east from the player: the robot's half is the east one. */
const FAR_BOUNCE_X = TABLE_X + TABLE_LENGTH * 0.27
const NEAR_BOUNCE_X = TABLE_X - TABLE_LENGTH * 0.27
/**
 * One rally, a full cycle each TRAIN_INTERVAL (one Power gain): off your paddle, a bounce
 * on the far half, into the robot; back out of it, a bounce on your half, onto your
 * paddle. Legs as [until (0-1 of the cycle), arc height].
 */
const LEGS = [
  [0.32, 0.85],
  [0.5, 0.35],
  [0.78, 0.6],
  [1, 0.5],
]

const _hit = new Vector3()
const _a = new Vector3()
const _b = new Vector3()

/** Where the paddle meets the ball for a player at (x, y, z) facing the table (east). */
export function hitPoint(x, y, z, out = _hit) {
  // A little in front and to the right (south, facing east), at chest height.
  return out.set(x + 0.75, y + 1.25, z + 0.5)
}

/**
 * The rally ball for a player training at pad `pad`, standing at (x, y, z), `time`
 * seconds into the clock: writes its centre into `out` and returns the cycle phase.
 */
export function rallyBall(time, pad, x, y, z, out) {
  const u = rallyPhase(time)
  const pz = padCenterZ(pad)
  hitPoint(x, y, z, _hit)
  // The four points the ball travels between.
  const p0 = _hit
  let from = 0
  for (let leg = 0; leg < LEGS.length; leg += 1) {
    const [until, arc] = LEGS[leg]
    if (u > until && leg < LEGS.length - 1) {
      from = until
      continue
    }
    pointOf(leg, p0, pz, _a)
    pointOf(leg + 1, p0, pz, _b)
    const s = (u - from) / (until - from)
    out.lerpVectors(_a, _b, s)
    out.y += arc * 4 * s * (1 - s)
    return u
  }
  return u
}

/** Rally point `i`: 0 and 4 your paddle, 1 the far bounce, 2 the robot, 3 your half. */
function pointOf(i, paddle, pz, out) {
  if (i === 0 || i === 4) return out.copy(paddle)
  if (i === 1) return out.set(FAR_BOUNCE_X, TOP, pz + 0.35)
  if (i === 2) return out.set(ROBOT_X - 0.45, TABLE_HEIGHT + 0.42, pz)
  return out.set(NEAR_BOUNCE_X, TOP, pz + 0.45)
}

// --- The jump smash ------------------------------------------------------------------

/** How high you leap to smash a serve, by how well it was timed (HIT_GRADES id). */
export const HIT_LEAP = { weak: 0, good: 0.55, great: 1.15, perfect: 1.9 }

/**
 * Your height off the ground `t` (0-1) through the serve's swing (playerPose, over
 * ROLL_LAUNCH) for a hit graded `hit`: up from the crouch, peaking as the paddle meets
 * the ball (KICK_IMPACT, 0.52), and down again. Auto Serve (no grade) doesn't leap.
 */
export function leapAt(hit, t) {
  const h = HIT_LEAP[hit] ?? 0
  if (!h || t < 0.12 || t > 0.94) return 0
  const u = (t - 0.52) / (t < 0.52 ? 0.4 : 0.42)
  return h * Math.max(0, 1 - u * u)
}

// --- A paddle in the hand -------------------------------------------------------------

/** The paddle's size in the hand: its blade's radius, in metres. */
export const HELD_PADDLE_SIZE = 0.3
/**
 * How a paddle (tire.js's frame: blade in the YZ plane round the origin, handle down -Y,
 * the grip about 1.9 down it) sits in the hand (avatarRig.placeHand's frame: the
 * character's at rest, the arm hanging): hanging from the fist, blade below, its face
 * forwards - so the arm swinging forwards hits with the face.
 */
export const HOLD_QUATERNION = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 1).normalize(), Math.PI)
export const HOLD_POSITION = new Vector3(0, -1.9 * HELD_PADDLE_SIZE, 0)
