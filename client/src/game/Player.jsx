import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Matrix4, Quaternion, Vector3 } from 'three'

import { isPadUnlocked } from '@shared/logic'
import { clampToWalkable, groundHeightAt, PAD_YAW, padAt, STATIC_COLLIDERS } from '@shared/world'

import { sfx } from '../audio/sfx'
import { getGame } from '../store/game'
import { getQuality } from '../store/quality'
import { burst } from './fx/fxQueue'
import ErrorBoundary from '../ui/ErrorBoundary'
import FallbackAvatar from './FallbackAvatar'
import PlayerAvatar from './PlayerAvatar'
import { RALLY_IMPACT } from './playerPose'
import { ROLL_LAUNCH } from '@shared/balance'
import { createBallMesh, disposeBallMesh } from './ball'
import { leapAt } from './pong'
import { HELD_PADDLE_SIZE, HOLD_POSITION, HOLD_QUATERNION, RALLY_BALL_SIZE, rallyBall, rallyPhase } from './pong'
import { roll } from './roll/rollControl'
import { runtime } from './runtime'
import { createTireModel } from './tire'
import useKeyboard from './useKeyboard'

export const PLAYER_HEIGHT = 1.8
const RADIUS = 0.45

const WALK_SPEED = 10.875
const ACCELERATION = 16
const GRAVITY = 32
const JUMP_SPEED = 10.5
/** Ledges up to this high are walked straight onto (the showroom's back stage). */
const STEP_UP = 1.05

// Scratch objects, reused each frame so the loop allocates nothing.
const _input = new Vector3()
const _move = new Vector3()
const _camForward = new Vector3()
const _camRight = new Vector3()
const _targetQuat = new Quaternion()
const _up = new Vector3(0, 1, 0)
const _clamped = { x: 0, z: 0 }
const _ball = new Vector3()
const _q = new Quaternion()
const _s = new Vector3()
const _m = new Matrix4()

/** Standing on the SERVE ZONE, your ball floats this far ahead and to the right, ready. */
const READY_AHEAD = 0.85
const READY_RIGHT = 0.5
const READY_HEIGHT = 1.25
/** Ball instances: the one waiting on the serve zone, and the one in a rally. */
const WAITING = 0
const RALLY = 1
/** 0 -> 1 with a springy overshoot, for things popping into view. */
const easeOutBack = (x) => {
  const t = Math.min(1, Math.max(0, x)) - 1
  return 1 + 2.70158 * t * t * t + 1.70158 * t * t
}

/** Pushes a circle out of an axis-aligned rect. Returns true on contact. */
function pushOut(pos, rect) {
  const cx = Math.min(rect.maxX, Math.max(rect.minX, pos.x))
  const cz = Math.min(rect.maxZ, Math.max(rect.minZ, pos.z))
  const dx = pos.x - cx
  const dz = pos.z - cz
  const d2 = dx * dx + dz * dz
  if (d2 >= RADIUS * RADIUS) return false

  if (d2 > 1e-8) {
    const d = Math.sqrt(d2)
    const push = (RADIUS - d) / d
    pos.x += dx * push
    pos.z += dz * push
    return true
  }

  // Centre inside the rect (spawned in, or a wall appeared on top of us): leave by the
  // nearest side.
  const left = pos.x - rect.minX
  const right = rect.maxX - pos.x
  const near = pos.z - rect.minZ
  const far = rect.maxZ - pos.z
  const m = Math.min(left, right, near, far)
  if (m === left) pos.x = rect.minX - RADIUS
  else if (m === right) pos.x = rect.maxX + RADIUS
  else if (m === near) pos.z = rect.minZ - RADIUS
  else pos.z = rect.maxZ + RADIUS
  return true
}

/**
 * The local player: a kinematic character controller.
 *
 * No physics engine: the world is flat ground, a few raised floors and a list of
 * rectangular walls, which a circle-vs-rect push-out handles exactly. That saves the
 * ~2 MB Rapier WASM download and keeps the active rigid body count at zero.
 *
 * While your ball flies you stay on the SERVE ZONE (what the server checks), watching
 * it go; Roll.jsx draws it and moves the camera. At a training table you face the table
 * and rally with its ball robot, a swing every TRAIN_INTERVAL. On the serve zone your
 * ball floats in front of you, ready. Your paddle is always in your hand.
 *
 * Reads and writes `runtime.player`; never touches React state per frame.
 *
 * @param {{ onAvatarReady?: () => void }} props
 */
export function Player({ onAvatarReady }) {
  const groupRef = useRef(null)
  const visualRef = useRef(null)
  const handRef = useRef(null)
  const ballsRef = useRef(null)
  const keys = useKeyboard()
  const velocity = useRef(new Vector3())
  const vy = useRef(0)
  /** The waiting ball's pop-in (0-1) on the serve zone. */
  const ready = useRef(0)
  /** Where the rally was last frame (0-1): wrapping round is the paddle meeting the ball. */
  const lastRally = useRef(1)
  /** Your paddle, held in the hand (HOLD_*), and the balls: waiting, and in a rally. */
  const paddle = useMemo(() => {
    const model = createTireModel()
    model.position.copy(HOLD_POSITION)
    model.quaternion.copy(HOLD_QUATERNION)
    model.scale.setScalar(HELD_PADDLE_SIZE)
    return model
  }, [])
  const balls = useMemo(() => createBallMesh(2), [])

  /** Handed to the avatar so it can pose itself. A ref: written every frame. */
  const motionRef = useRef({
    time: 0,
    speed: 0,
    grounded: true,
    maxSpeed: WALK_SPEED,
    vy: 0,
    stride: 0,
  })

  // The blob shadow follows the character.
  const shownAt = useMemo(() => new Vector3().copy(runtime.player.position), [])
  useEffect(() => {
    const caster = { position: shownAt, size: 1.1 }
    runtime.shadowCasters.add(caster)
    return () => runtime.shadowCasters.delete(caster)
  }, [shownAt])

  useEffect(
    () => () => {
      paddle.dispose()
      disposeBallMesh(balls)
    },
    [paddle, balls],
  )

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const player = runtime.player
    const pos = player.position
    const k = keys.current
    const joy = runtime.input
    const motion = motionRef.current
    motion.time += delta

    const group = groupRef.current
    const visual = visualRef.current
    const time = state.clock.elapsedTime
    const equipped = getGame().profile.equippedTire
    paddle.setTire(equipped)
    const balls = ballsRef.current
    balls.count = 2
    // The balls dressed as your paddle's ball: a new paddle, a new ball.
    balls.setBall(WAITING, equipped)
    balls.setBall(RALLY, equipped)

    // --- Ready to serve: your ball floats in front of you on the SERVE ZONE ---------
    const waiting = getGame().zone.rollZone && !player.frozen && !roll.active
    // Pressing SERVE hands it to the serve at once (Roll.jsx tosses it), in the same spot.
    if (roll.active) ready.current = 0
    else ready.current = waiting ? Math.min(1, ready.current + delta * 4) : Math.max(0, ready.current - delta * 6)
    const yaw = player.yaw
    _ball.set(
      pos.x + Math.sin(yaw) * READY_AHEAD - Math.cos(yaw) * READY_RIGHT,
      pos.y + READY_HEIGHT + Math.sin(time * 3) * 0.08,
      pos.z + Math.cos(yaw) * READY_AHEAD + Math.sin(yaw) * READY_RIGHT,
    )
    _s.setScalar(RALLY_BALL_SIZE * 1.3 * easeOutBack(ready.current))
    balls.setMatrixAt(WAITING, _m.compose(_ball, _q.identity(), _s))

    // --- Input, relative to the camera ----------------------------------------
    _input.set(0, 0, 0)
    if (!player.frozen) {
      _input.set(
        (k.right ? 1 : 0) - (k.left ? 1 : 0) + joy.joyX,
        0,
        (k.backward ? 1 : 0) - (k.forward ? 1 : 0) - joy.joyY,
      )
    }
    const inputLength = Math.min(1, _input.length())

    if (inputLength > 0.02) {
      _input.normalize()
      // Flatten the camera's forward onto the ground plane so "up" always means
      // "away from the camera".
      state.camera.getWorldDirection(_camForward)
      _camForward.y = 0
      _camForward.normalize()
      _camRight.crossVectors(_camForward, _up).normalize()
      _move
        .set(0, 0, 0)
        .addScaledVector(_camForward, -_input.z)
        .addScaledVector(_camRight, _input.x)
        .normalize()
        .multiplyScalar(WALK_SPEED * inputLength)
    } else {
      _move.set(0, 0, 0)
    }

    // Ease towards the target velocity: crisp, but no instant 0->max snaps.
    const blend = 1 - Math.exp(-ACCELERATION * delta)
    velocity.current.lerp(_move, blend)

    // --- Horizontal move + collision --------------------------------------------
    const prevX = pos.x
    const prevZ = pos.z
    pos.x += velocity.current.x * delta
    pos.z += velocity.current.z * delta

    for (const rect of STATIC_COLLIDERS) pushOut(pos, rect)
    for (const rect of runtime.dynamicColliders) pushOut(pos, rect)
    clampToWalkable(pos.x, pos.z, _clamped)
    pos.x = _clamped.x
    pos.z = _clamped.z

    // A ledge too tall to step onto acts as a wall.
    let floor = groundHeightAt(pos.x, pos.z)
    if (floor - pos.y > STEP_UP) {
      pos.x = prevX
      pos.z = prevZ
      floor = groundHeightAt(pos.x, pos.z)
    }

    // --- Vertical ---------------------------------------------------------------
    const wantJump = !player.frozen && (k.jump || joy.jump)
    if (wantJump && player.grounded) {
      vy.current = JUMP_SPEED
      player.grounded = false
      sfx.jump()
    }
    vy.current -= GRAVITY * delta
    pos.y += vy.current * delta

    if (pos.y <= floor) {
      // Coming down from a jump (not just stepping off a kerb) lands with a thump.
      if (!player.grounded && vy.current < -5) sfx.jumpLand()
      pos.y = floor
      vy.current = 0
      player.grounded = true
    } else if (pos.y - floor > 0.05) {
      // Walked off a ledge, or still rising from a jump.
      player.grounded = false
    }

    // --- Facing -----------------------------------------------------------------
    const speed = Math.hypot(velocity.current.x, velocity.current.z)
    // Standing still on an unlocked pad: rally at its table.
    const pad = padAt(pos.x, pos.z)
    const running = pad >= 0 && player.grounded && speed < 0.5 && !player.frozen && isPadUnlocked(getGame().profile, pad)
    if (running) player.yaw = PAD_YAW
    else if (speed > 0.3) player.yaw = Math.atan2(velocity.current.x, velocity.current.z)
    if (visual) {
      _targetQuat.setFromAxisAngle(_up, player.yaw)
      visual.quaternion.slerp(_targetQuat, 1 - Math.pow(0.0005, delta))
    }
    if (group) {
      // Step-ups ease in over a few frames on the visual only; the logical position
      // snaps so collision and triggers stay exact.
      const steppingUp = player.grounded && pos.y > group.position.y
      const visualY = steppingUp
        ? group.position.y + (pos.y - group.position.y) * Math.min(1, delta * 18)
        : pos.y
      group.position.set(pos.x, visualY, pos.z)
    }
    shownAt.copy(pos)

    // --- Rallying at a training table -------------------------------------------
    // The ball flies between your paddle and the table's robot, one hit per gain.
    if (running) {
      const u = rallyBall(time, pad, pos.x, pos.y, pos.z, _ball)
      if (u < lastRally.current) {
        // Tok! And a little spark off the paddle.
        sfx.pong(true)
        if (getQuality().particles) burst({ x: _ball.x, y: _ball.y, z: _ball.z, count: 6, speed: 3, palette: 'gold' })
      }
      lastRally.current = u
      _s.setScalar(RALLY_BALL_SIZE)
    } else {
      _s.setScalar(0)
    }
    balls.setMatrixAt(RALLY, _m.compose(_ball, _q.identity(), _s))
    balls.instanceMatrix.needsUpdate = true

    // --- Publish motion ---------------------------------------------------------
    player.speed = speed
    player.anim = !player.grounded ? 'jump' : running ? 'run' : speed > 0.5 ? 'walk' : 'idle'

    const shownSpeed = running ? 0 : speed
    motion.speed = shownSpeed
    motion.grounded = player.grounded
    motion.vy = vy.current
    // At a table: a swing every rally, timed to meet the ball (pong.rallyBall).
    motion.hit = running ? (rallyPhase(time) + RALLY_IMPACT) % 1 : -1
    // The serve's swing when you press SERVE: how far through it (below 0: not).
    const sinceRoll = roll.active ? (performance.now() - roll.startedAt) / 1000 : -1
    motion.kick = sinceRoll >= 0 && sinceRoll < ROLL_LAUNCH ? sinceRoll / ROLL_LAUNCH : -1
    // A jump smash on a well-timed serve: as high as the hit is good (pong.leapAt).
    motion.leap = motion.kick >= 0 ? leapAt(roll.hit, motion.kick) : 0
    if (visual) visual.position.y = motion.leap
    // Steps quicken with speed: the stride phase runs faster rather than jumping.
    motion.stride += delta * (5 + 6 * Math.min(1, shownSpeed / WALK_SPEED))
  })

  return (
    <>
      <group ref={groupRef}>
        <group ref={visualRef}>
          <ErrorBoundary fallback={<FallbackAvatar motionRef={motionRef} handRef={handRef} onReady={onAvatarReady} />}>
            <Suspense fallback={<FallbackAvatar motionRef={motionRef} handRef={handRef} />}>
              <PlayerAvatar onReady={onAvatarReady} targetHeight={PLAYER_HEIGHT} motionRef={motionRef} handRef={handRef} />
            </Suspense>
          </ErrorBoundary>
          <group ref={handRef}>
            <primitive object={paddle} />
          </group>
        </group>
      </group>
      {/* The balls are placed in world space. */}
      <primitive ref={ballsRef} object={balls} />
    </>
  )
}

export default Player
