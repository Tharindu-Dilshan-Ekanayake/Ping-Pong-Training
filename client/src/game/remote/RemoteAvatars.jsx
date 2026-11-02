import { useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Matrix4, Vector3 } from 'three'

import { ROLL_LAUNCH } from '@shared/balance'
import { PAD_YAW } from '@shared/world'

import { remotePlayers } from '../../net/remotePlayers'
import { getQuality } from '../../store/quality'
import { runtime } from '../runtime'
import { emoteFromAnim } from '../../bloxity/emotes'
import { RALLY_IMPACT } from '../playerPose'
import { BloxityAvatar } from '../PlayerAvatar'
import { HELD_PADDLE_SIZE, HOLD_POSITION, HOLD_QUATERNION, leapAt, rallyPhase } from '../pong'
import { createTireMesh, tireMatrix } from '../tire'

/** How often the set of fully drawn players is reconsidered. */
const PICK_MS = 500
/** Top walking speed: full stride amplitude, as for your own character. */
const MAX_SPEED = 10.875
/** Facing down the track, as your own character does to kick off a roll. */
const TRACK_YAW = Math.PI
const _up = new Vector3(0, 1, 0)
const _m = new Matrix4()
/** A held paddle's place in the hand (pong.HOLD_*), as a matrix. */
const HOLD = new Matrix4()

/**
 * The hand of each fully drawn player (placed by avatarRig.placeHand), by session id:
 * RemotePaddles draws a paddle in every one, all in one draw call.
 */
const hands = new Map()

/**
 * One other player as their real Bloxity avatar, dressed as they are and posed by the
 * same playerPose as yours, from what the network says they're doing: walking pace,
 * rallying at a training table (RemotePlayers draws the ball), jumping. While they serve
 * they stay at the Serve Zone; their ball is the ghost ball flying down the track
 * (roll/Roll.jsx). Their paddle is in their hand (RemotePaddles).
 */
function RemoteAvatar({ sessionId, look }) {
  const groupRef = useRef(null)
  const handRef = useRef(null)
  /** This player's entry in `hands`: made once, updated in place every frame. */
  const held = useRef({ hand: null, tireId: null })
  const lastY = useRef(null)
  const motionRef = useRef({ time: 0, speed: 0, grounded: true, maxSpeed: MAX_SPEED, vy: 0, stride: 0 })

  useFrame((_state, rawDelta) => {
    const group = groupRef.current
    const r = remotePlayers.get(sessionId)
    if (!group || !r) return
    const delta = Math.min(rawDelta, 0.05)
    const m = motionRef.current
    m.time += delta

    const running = r.anim === 'run'
    // Rolling: they kick their tire off from the roll zone (the ghost tire waits for the
    // foot, then goes - roll/Roll.jsx), squared up to the track.
    const ghost = runtime.ghostRolls.get(sessionId)
    const sinceRoll = ghost ? (performance.now() - ghost.startedAt) / 1000 : -1
    const kicking = sinceRoll >= 0 && sinceRoll < ROLL_LAUNCH
    m.kick = kicking ? sinceRoll / ROLL_LAUNCH : -1
    group.visible = true
    group.position.copy(r.position)
    // Their jump smash, as high as their hit was good.
    m.leap = kicking ? leapAt(ghost.hit, m.kick) : 0
    group.position.y += m.leap
    group.quaternion.setFromAxisAngle(_up, kicking ? TRACK_YAW : running ? PAD_YAW : r.yaw)
    // At a table: a swing every rally, as yours does.
    m.hit = running ? (rallyPhase(_state.clock.elapsedTime) + RALLY_IMPACT) % 1 : -1
    if (handRef.current) {
      held.current.hand = handRef.current
      held.current.tireId = r.tireId
      hands.set(sessionId, held.current)
    }

    const speed = running ? 0 : r.speed
    m.speed = speed
    m.grounded = r.anim !== 'jump'
    // A Boxity emote they're playing (stood still while it lasts).
    m.emote = emoteFromAnim(r.anim)
    if (m.emote) m.speed = 0
    // Vertical speed from the interpolated height, smoothed: rising vs falling.
    const y = r.position.y
    if (lastY.current !== null) m.vy += ((y - lastY.current) / Math.max(delta, 1e-3) - m.vy) * 0.3
    lastY.current = y
    m.stride += delta * (5 + 6 * Math.min(1, speed / MAX_SPEED))
  })

  useEffect(() => () => hands.delete(sessionId), [sessionId])

  return (
    <group ref={groupRef}>
      <BloxityAvatar equipped={look?.equipped} proportions={look?.proportions} motionRef={motionRef} handRef={handRef} targetHeight={1.8} />
      <group ref={handRef} />
    </group>
  )
}

/** Every fully drawn player's paddle, in their hand: one instanced mesh for them all. */
function RemotePaddles({ max }) {
  const ref = useRef(null)
  const paddles = useMemo(() => createTireMesh(max), [max])
  useEffect(
    () => () => {
      paddles.geometry.dispose()
      paddles.dispose()
    },
    [paddles],
  )
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    let n = 0
    for (const { hand, tireId } of hands.values()) {
      if (n >= max) break
      hand.updateWorldMatrix(true, false)
      tireMatrix(HOLD_POSITION, HOLD_QUATERNION, HELD_PADDLE_SIZE, tireId, HOLD)
      mesh.setMatrixAt(n, _m.multiplyMatrices(hand.matrixWorld, HOLD))
      mesh.setStyle(n, tireId)
      n += 1
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
  })
  return <primitive ref={ref} object={paddles} />
}

/**
 * The other players nearest the camera, as their real avatars - standing, walking or
 * training: as many as the quality preset allows (`remoteAvatars`), within
 * `remoteAvatarDistance` - on every preset, everyone in the room, near or far. Anyone
 * beyond those limits would be the cheap blocky figure RemotePlayers draws
 * (`r.fullAvatar` tells it who's covered).
 * Chosen twice a second, never per frame, so React only re-renders when the set of
 * players (or an outfit) actually changes.
 */
export function RemoteAvatars() {
  const camera = useThree((s) => s.camera)
  const [shown, setShown] = useState([])

  useEffect(() => {
    const pick = () => {
      const settings = getQuality()
      const near = []
      for (const r of remotePlayers.values()) {
        r.fullAvatar = false
        const d = camera.position.distanceTo(r.position)
        if (d < settings.remoteAvatarDistance) near.push([d, r])
      }
      near.sort((a, b) => a[0] - b[0])
      const next = near
        .slice(0, settings.remoteAvatars)
        .map(([, r]) => r)
        .sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1))
      for (const r of next) r.fullAvatar = true
      setShown((prev) => {
        const same = prev.length === next.length && prev.every((p, i) => p.sessionId === next[i].sessionId && p.lookKey === next[i].lookKey)
        return same ? prev : next.map((r) => ({ sessionId: r.sessionId, look: r.look, lookKey: r.lookKey }))
      })
    }
    pick()
    const id = setInterval(pick, PICK_MS)
    return () => clearInterval(id)
  }, [camera])

  return (
    <>
      {shown.map((s) => (
        <Suspense key={`${s.sessionId}:${s.lookKey}`} fallback={null}>
          <RemoteAvatar sessionId={s.sessionId} look={s.look} />
        </Suspense>
      ))}
      <RemotePaddles max={getQuality().remoteAvatars} />
    </>
  )
}

export default RemoteAvatars
