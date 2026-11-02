import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Color, Euler, Mesh, PlaneGeometry, Quaternion, ShaderMaterial, Vector3, Matrix4 } from 'three'

import { getQuality } from '../../store/quality'
import { fireBurst } from '../fx/fxQueue'
import { createBoxInstances, disposeBlocks } from '../blocks'
import { sharedMaterials, STYLE } from '../materials'
import { tireGlow } from '../tire'
import { slopeY, SLOPE_EULER_X, trackPoint } from './path'
import { roll } from './rollControl'
import { LANE_RAINBOW, LANE_STRIPE } from './themes'

/**
 * The ball slamming down at the end of its arc (rollControl's `impact`): the lane cracks
 * open under it - a crater with depth (a dark pit, its far wall lit, a molten heart
 * while it's hot), a ragged rim, jagged cracks racing out thick to thin with glowing
 * cores cooling to dark, a scorch mark and two shockwaves across the ground - slabs of
 * the lane burst up round the rim and stay there, chunks fly, tumble and bounce away,
 * dust billows up (FireBurst's 'dust'), and the ball hops in the crater and settles
 * into it (path.rideState).
 *
 * The crater and cracks are one procedural quad (no texture); the chunks are a fixed
 * pool of boxes, one draw call: CHUNKS of them, or CHUNKS_LOW on presets without
 * particles (a few hundred triangles - the landing reads as a smash on phones too).
 * Nothing is allocated while it plays.
 */

const CHUNKS = 28
const CHUNKS_LOW = 12
/** Slabs of lane pushed up round the crater's rim (after the chunks in the same mesh). */
const RUBBLE = 16
const RUBBLE_LOW = 10
/** The rubble pops up over this long, stays, then sinks away with the crater. */
const RUBBLE_POP = 0.14
const RUBBLE_GONE = [3.6, 4.4]
const GRAVITY = 28
const CHUNK_LIFE = 2.6
/** The crack's radius on the lane: bigger the higher the ball fell. */
const crackRadius = (peak) => 2.5 + peak * 0.22

const DIRT = new Color('#7a4a2a')
const ROCK = new Color('#b9a48a')
const ZERO = new Matrix4().makeScale(0, 0, 0)
const _up = new Vector3()
const _axis = new Vector3()
const _stripe = new Color()

const crackVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const crackFragment = /* glsl */ `
  uniform float uAge;
  uniform vec3 uGlow;
  uniform float uSeed;
  varying vec2 vUv;
  const float TAU = 6.2831853;
  float hash(float n) {
    return fract(sin(n * 127.1 + uSeed * 13.7) * 43758.5453);
  }
  float noise1(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), f);
  }
  void main() {
    // -1..1 across the quad; the cracks reach about half way, the shockwaves all the way.
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    vec2 dir = r > 0.0001 ? p / r : vec2(0.0, 1.0);
    // Light from up the lane and to the left, as the sun: which side of the pit's wall
    // and of its rim faces it.
    float lit = dot(dir, normalize(vec2(-0.6, 0.8)));
    // The cracks race out over the first third of a second; the heat in them cools
    // over two; the whole lot fades at the end.
    float grow = 1.0 - pow(1.0 - clamp(uAge / 0.35, 0.0, 1.0), 3.0);
    float hot = 1.0 - smoothstep(0.15, 2.0, uAge);
    float fade = 1.0 - smoothstep(3.6, 4.6, uAge);
    // Glowing in the paddle's colour, pushed towards a fiery orange.
    vec3 heat = mix(uGlow, vec3(1.0, 0.5, 0.12), 0.45);

    // The pit: a ragged edge punched in at once, darkest at the bottom, its far wall
    // catching the light, and a molten heart while it's hot.
    float edgeR = 0.17 * (0.88 + 0.24 * noise1(a / TAU * 9.0 + 3.0)) * min(1.0, uAge / 0.05 + 0.5);
    float pit = 1.0 - smoothstep(edgeR - 0.012, edgeR, r);
    float depth = r / edgeR;
    vec3 pitCol = mix(vec3(0.03, 0.02, 0.03), vec3(0.3, 0.2, 0.15), smoothstep(0.3, 1.0, depth) * (0.5 - 0.45 * lit));
    pitCol += heat * hot * 1.3 * (1.0 - smoothstep(0.0, 0.75, depth));
    // The broken rim pushed up round it: pale, lit on the side facing the sun.
    float rim = smoothstep(edgeR - 0.008, edgeR + 0.004, r) * (1.0 - smoothstep(edgeR + 0.01, edgeR + 0.065, r));
    vec3 rimCol = vec3(0.86, 0.78, 0.68) * (0.62 + 0.45 * lit);

    // The cracks: seven long ones, then shorter and thinner branches between them, each
    // a dark gash thick at the pit and tapering to a point, with a hot glowing core.
    float crack = 0.0;
    float halo = 0.0;
    for (int i = 0; i < 3; i++) {
      float n = i == 0 ? 7.0 : (i == 1 ? 13.0 : 23.0);
      float reach = i == 0 ? 0.64 : (i == 1 ? 0.44 : 0.27);
      float s = a / TAU * n + 0.5 + float(i) * 0.37;
      float k = floor(s);
      float wob = 0.18 * sin(r * 23.0 + k * 2.3) + 0.09 * sin(r * 61.0 + k * 5.1);
      float off = abs(fract(s + wob * (0.25 + r)) - 0.5);
      float dist = off / n * TAU * r;
      float len = reach * (0.5 + 0.5 * hash(k + float(i) * 31.0)) * grow;
      float t = clamp((r - edgeR) / max(len - edgeR, 0.001), 0.0, 1.0);
      float w = mix(0.034, 0.004, t) * (i == 0 ? 1.0 : (i == 1 ? 0.72 : 0.48));
      float inside = step(r, len) * step(edgeR * 0.9, r);
      crack = max(crack, (1.0 - smoothstep(w * 0.5, w, dist)) * inside);
      halo = max(halo, (1.0 - smoothstep(w, w * 3.5, dist)) * inside * (1.0 - t));
    }
    float core = crack * hot * (1.0 - smoothstep(0.0, 0.5, max(0.0, r - edgeR) / 0.5));
    vec3 crackCol = mix(vec3(0.05, 0.03, 0.04), heat * 1.7 + vec3(0.25), core);

    // A scorch mark round it all, and two shockwaves: a sharp bright one racing out and
    // a broader dusty one behind it.
    float scorch = (1.0 - smoothstep(edgeR, edgeR + 0.38, r)) * 0.5;
    float r1 = uAge * 3.0;
    float r2 = uAge * 2.0 - 0.04;
    float ring1 = (1.0 - smoothstep(0.0, 0.04, abs(r - r1))) * (1.0 - smoothstep(0.0, 0.4, uAge));
    float ring2 = (1.0 - smoothstep(0.0, 0.08, abs(r - r2))) * (1.0 - smoothstep(0.05, 0.6, uAge)) * step(0.0, r2);

    // Back to front.
    vec3 col = vec3(0.13, 0.09, 0.07);
    float alpha = scorch;
    col = mix(col, heat * 1.3, halo * hot * 0.8);
    alpha = max(alpha, halo * hot * 0.6);
    col = mix(col, crackCol, crack);
    alpha = max(alpha, crack);
    col = mix(col, rimCol, rim);
    alpha = max(alpha, rim);
    col = mix(col, pitCol, pit);
    alpha = max(alpha, pit);
    col = mix(col, vec3(1.0), ring1);
    alpha = max(alpha, ring1 * 0.85 * step(r, 1.0));
    col = mix(col, vec3(1.0, 0.95, 0.85), ring2 * 0.6);
    alpha = max(alpha, ring2 * 0.45 * step(r, 1.0));

    alpha *= fade;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`

/** Lying flat on the slope, like the lane's painted numbers. */
const FLAT = new Quaternion().setFromEuler(new Euler(-Math.PI / 2 + SLOPE_EULER_X, 0, 0))
const _m = new Matrix4()
const _q = new Quaternion()
const _s = new Vector3()

function createCrack() {
  const material = new ShaderMaterial({
    uniforms: { uAge: { value: 99 }, uGlow: { value: new Color('#ffb347') }, uSeed: { value: 0 } },
    vertexShader: crackVertex,
    fragmentShader: crackFragment,
    transparent: true,
    depthWrite: false,
  })
  const mesh = new Mesh(new PlaneGeometry(1, 1), material)
  mesh.quaternion.copy(FLAT)
  mesh.renderOrder = 2
  // Never hidden, only shrunk to nothing between impacts: a hidden mesh isn't compiled
  // with the rest of the serve (Roll.jsx), and compiling its shader at the moment the
  // ball lands would freeze a weak GPU right then. Shrunk, it costs one empty draw call.
  mesh.scale.setScalar(0)
  mesh.frustumCulled = false
  return mesh
}

/** The chunks' state, made once: each one's flight, tumble and size. */
const chunks = Array.from({ length: CHUNKS }, () => ({
  pos: new Vector3(),
  vel: new Vector3(),
  axis: new Vector3(0, 1, 0),
  angle: 0,
  spin: 0,
  size: 0.5,
}))

/** The rubble's state, made once: where each slab stands, its size and its tilt. */
const rubble = Array.from({ length: RUBBLE }, () => ({ pos: new Vector3(), quat: new Quaternion(), size: new Vector3(), on: false }))

export default function Impact() {
  const crackRef = useRef(null)
  const chunksRef = useRef(null)
  /** The impact (its impactAt) the effect was last started for, and when the chunks flew. */
  const shown = useRef({ at: 0, chunksAt: 0, count: CHUNKS })
  const assets = useMemo(() => {
    const debris = createBoxInstances(CHUNKS + RUBBLE, sharedMaterials().toy, STYLE.SMOOTH)
    debris.castShadow = false
    return { crack: createCrack(), debris }
  }, [])

  useEffect(
    () => () => {
      assets.crack.geometry.dispose()
      assets.crack.material.dispose()
      disposeBlocks(assets.debris)
    },
    [assets],
  )

  useFrame((_state, rawDelta) => {
    const crack = crackRef.current
    const debris = chunksRef.current
    if (!crack || !debris) return
    const dt = Math.min(rawDelta, 0.05)
    const now = performance.now()
    const st = shown.current

    if (!roll.active || !roll.impactAt) {
      crack.scale.setScalar(0)
      debris.count = 0
      return
    }

    if (st.at !== roll.impactAt) {
      // A new landing: lay the crack where it hit, and throw the chunks.
      st.at = roll.impactAt
      // A PERFECT hit lands hardest, a WEAK one barely dents the lane.
      const size = crackRadius(roll.impactPeak) * (roll.hit === 'perfect' ? 1.35 : roll.hit === 'weak' ? 0.7 : 1)
      trackPoint(roll.impactMeter, roll.impact.x, 0.09, crack.position)
      crack.scale.setScalar(size * 4)
      crack.material.uniforms.uGlow.value.copy(tireGlow(roll.tireId))
      crack.material.uniforms.uSeed.value = Math.floor(roll.impactMeter) % 97
      const full = getQuality().particles
      st.count = full ? CHUNKS : CHUNKS_LOW
      st.chunksAt = now
      const power = Math.min(1, roll.impactPeak / 32)
      _stripe.set(LANE_RAINBOW[Math.floor(roll.impactMeter / LANE_STRIPE) % LANE_RAINBOW.length])
      for (let i = st.count; i < CHUNKS; i += 1) debris.setMatrixAt(i, ZERO)
      // Slabs of the lane pushed up round the rim, leaning outwards, in the lane's colour
      // with the odd lump of dirt.
      const rim = size * 2 * 0.17
      const slabs = full ? RUBBLE : RUBBLE_LOW
      for (let i = 0; i < RUBBLE; i += 1) {
        const b = rubble[i]
        b.on = i < slabs
        if (!b.on) {
          debris.setMatrixAt(CHUNKS + i, ZERO)
          continue
        }
        const a = (i / slabs) * Math.PI * 2 + Math.random() * 0.3
        const out = rim * (1.02 + Math.random() * 0.22)
        const piece = 0.28 + 0.05 * size
        b.size.set(piece * (0.9 + Math.random() * 0.8), piece * (0.35 + Math.random() * 0.25), piece * (0.7 + Math.random() * 0.6))
        b.pos.set(crack.position.x + Math.cos(a) * out, crack.position.y + b.size.y * 0.25, crack.position.z + Math.sin(a) * out)
        // Turned to face out from the crater, then tipped outwards about its edge.
        b.quat.setFromAxisAngle(_up.set(0, 1, 0), -a)
        _axis.set(-Math.sin(a), 0, Math.cos(a))
        b.quat.premultiply(_q.setFromAxisAngle(_axis, -(0.35 + Math.random() * 0.55)))
        debris.setColorAt(CHUNKS + i, i % 4 === 3 ? DIRT : _stripe)
      }
      // Dust billowing up out of it.
      fireBurst(crack.position.x, crack.position.y + 0.4, crack.position.z, 'dust')
      for (let i = 0; i < st.count; i += 1) {
        const c = chunks[i]
        const a = (i / st.count) * Math.PI * 2 + Math.random() * 0.4
        const out = 0.3 + Math.random() * 0.7
        c.pos.set(crack.position.x + Math.cos(a) * size * 0.3 * out, crack.position.y + 0.3, crack.position.z + Math.sin(a) * size * 0.3 * out)
        const speed = (3 + Math.random() * 7) * (0.6 + 0.6 * power)
        c.vel.set(Math.cos(a) * speed, (6 + Math.random() * 9) * (0.7 + 0.5 * power), Math.sin(a) * speed)
        c.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
        c.angle = Math.random() * 3
        c.spin = (Math.random() - 0.5) * 14
        c.size = (0.35 + Math.random() * 0.55) * (0.8 + 0.6 * power)
        debris.setColorAt(i, i % 5 < 3 ? _stripe : i % 5 === 3 ? DIRT : ROCK)
      }
      debris.instanceColor.needsUpdate = true
    }

    crack.material.uniforms.uAge.value = (now - roll.impactAt) / 1000

    const age = (now - st.chunksAt) / 1000
    if (!st.chunksAt) {
      debris.count = 0
      return
    }
    // The rubble: popping up out of the ground with a little overshoot, standing round
    // the crater, and sinking away with it at the end.
    const pop = Math.min(1, age / RUBBLE_POP)
    const rise = pop < 1 ? 1 - Math.pow(1 - pop, 3) * Math.cos(pop * 4) : 1
    const sink = 1 - Math.min(1, Math.max(0, (age - RUBBLE_GONE[0]) / (RUBBLE_GONE[1] - RUBBLE_GONE[0])))
    for (let i = 0; i < RUBBLE; i += 1) {
      const b = rubble[i]
      if (!b.on) continue
      _s.copy(b.size).multiplyScalar(Math.max(0, rise) * sink)
      debris.setMatrixAt(CHUNKS + i, _m.compose(b.pos, b.quat, _s))
    }
    debris.count = CHUNKS + RUBBLE
    debris.instanceMatrix.needsUpdate = true

    // The chunks: flying, tumbling, bouncing off the ground, then shrinking away.
    if (age > CHUNK_LIFE) {
      for (let i = 0; i < st.count; i += 1) debris.setMatrixAt(i, ZERO)
      return
    }
    const shrink = 1 - Math.max(0, (age - (CHUNK_LIFE - 0.6)) / 0.6)
    for (let i = 0; i < st.count; i += 1) {
      const c = chunks[i]
      c.vel.y -= GRAVITY * dt
      c.pos.addScaledVector(c.vel, dt)
      const floor = slopeY(c.pos.z) + c.size * 0.5
      if (c.pos.y < floor) {
        c.pos.y = floor
        c.vel.y = Math.abs(c.vel.y) * 0.35
        c.vel.x *= 0.6
        c.vel.z *= 0.6
        c.spin *= 0.6
      }
      c.angle += c.spin * dt
      _q.setFromAxisAngle(c.axis, c.angle)
      debris.setMatrixAt(i, _m.compose(c.pos, _q, _s.set(c.size, c.size * 0.6, c.size * 0.8).multiplyScalar(shrink)))
    }
  })

  return (
    <>
      <primitive ref={crackRef} object={assets.crack} />
      <primitive ref={chunksRef} object={assets.debris} />
    </>
  )
}
