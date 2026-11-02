import { BufferGeometry, Color, InstancedBufferAttribute, InstancedMesh, MeshToonMaterial, SphereGeometry } from 'three'

import { glowTime } from './glow'

/**
 * The ping pong ball, dressed to match your paddle: every paddle has a ball of its own
 * (BALL_STYLES) - an orange slice, a pepperoni pizza, a sprinkled donut, glowing lava,
 * a twinkling galaxy, dragon scales... - all drawn by one shader (BALL_GLSL) from a
 * pattern id and three colours per instance, so every ball in a mesh, whatever it
 * looks like, is one draw call and one shader program. No textures.
 */

/** The designs BALL_GLSL can draw, by id. */
export const PATTERN = {
  BAND: 0,
  STRIPES: 1,
  SWIRL: 2,
  DOTS: 3,
  SEGMENTS: 4,
  LAVA: 5,
  GALAXY: 6,
  RAINBOW: 7,
  SCALES: 8,
  FACETS: 9,
  GRAIN: 10,
  SEAM: 11,
  SPRINKLES: 12,
  COIN: 13,
}

/**
 * Each paddle's ball, by paddle id (shared/balance.js TIRES): its pattern, its colours
 * (`a` the base, `b` and `c` the design) and how much it glows on its own.
 */
export const BALL_STYLES = {
  bicycle: { pattern: PATTERN.SEGMENTS, a: '#ff9a1e', b: '#fff3c0', c: '#ffffff' },
  mountain: { pattern: PATTERN.SEGMENTS, a: '#7ad83a', b: '#f4ffd0', c: '#ffffff' },
  wood: { pattern: PATTERN.GRAIN, a: '#d9a066', b: '#8a5a2a', c: '#ffffff' },
  stone: { pattern: PATTERN.DOTS, a: '#a9adb6', b: '#6e737c', c: '#d6d9de' },
  cookie: { pattern: PATTERN.DOTS, a: '#e0aa62', b: '#4a2a18', c: '#6a3a20' },
  pizza: { pattern: PATTERN.DOTS, a: '#ffcf3a', b: '#d8342a', c: '#3fae3a' },
  donut: { pattern: PATTERN.SPRINKLES, a: '#ff8fc8', b: '#ffe23a', c: '#3fc6ff' },
  watermelon: { pattern: PATTERN.STRIPES, a: '#2f9a3a', b: '#8ee07a', c: '#ffffff' },
  monster: { pattern: PATTERN.DOTS, a: '#ffd23a', b: '#e0a012', c: '#f0b81e' },
  mint: { pattern: PATTERN.SWIRL, a: '#ffffff', b: '#ff2a4a', c: '#ffffff' },
  silver: { pattern: PATTERN.COIN, a: '#d6dde8', b: '#8f9bb0', c: '#ffffff', glow: 0.1 },
  ice: { pattern: PATTERN.SPRINKLES, a: '#ffd0e4', b: '#ff3f6a', c: '#7a4a2a' },
  gold: { pattern: PATTERN.COIN, a: '#ffd21f', b: '#ff9a0a', c: '#ffffff', glow: 0.2 },
  lava: { pattern: PATTERN.LAVA, a: '#3a1410', b: '#ff6a1e', c: '#ffd21f' },
  platinum: { pattern: PATTERN.BAND, a: '#ffffff', b: '#1d3a28', c: '#ff8a5c' },
  emerald: { pattern: PATTERN.DOTS, a: '#62e63c', b: '#b8ff8a', c: '#3fae2a', glow: 0.25 },
  ruby: { pattern: PATTERN.STRIPES, a: '#eba24a', b: '#6a3a1a', c: '#ffffff' },
  diamond: { pattern: PATTERN.FACETS, a: '#bff0ff', b: '#3fb8ff', c: '#ffffff' },
  rainbow: { pattern: PATTERN.RAINBOW, a: '#ffffff', b: '#ffffff', c: '#ffffff', glow: 0.15 },
  unicorn: { pattern: PATTERN.SWIRL, a: '#ffd6f4', b: '#b8dcff', c: '#ffffff', glow: 0.1 },
  galaxy: { pattern: PATTERN.GALAXY, a: '#140c2a', b: '#a46bff', c: '#5fd6ff' },
  dragon: { pattern: PATTERN.SCALES, a: '#1f9a4a', b: '#ffd21f', c: '#ffffff' },
  cosmic: { pattern: PATTERN.SPRINKLES, a: '#fff0f6', b: '#ff3b5c', c: '#ffd21f' },
  infinity: { pattern: PATTERN.FACETS, a: '#ff7ad9', b: '#5fd6ff', c: '#fff27a', glow: 0.1 },
}

// Parsed once: setBall runs in frame loops and must not allocate.
const PARSED = Object.fromEntries(
  Object.entries(BALL_STYLES).map(([id, s]) => [id, { ...s, a: new Color(s.a), b: new Color(s.b), c: new Color(s.c), glow: s.glow ?? 0 }]),
)
const styleOf = (id) => PARSED[id] || PARSED.bicycle

const vertexHead = /* glsl */ `
  attribute vec3 aBallB;
  attribute vec3 aBallC;
  attribute vec3 aBallStyle;
  varying vec3 vBallP;
  varying vec3 vBallB;
  varying vec3 vBallC;
  varying vec3 vBallS;
`
const vertexBody = /* glsl */ `
  vBallP = position;
  vBallB = aBallB;
  vBallC = aBallC;
  vBallS = aBallStyle;
`

const fragmentHead = /* glsl */ `
  uniform float uBTime;
  varying vec3 vBallP;
  varying vec3 vBallB;
  varying vec3 vBallC;
  varying vec3 vBallS;
  const float BTAU = 6.2831853;
  float bHash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  vec3 bHue(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }
  /** Cells round jittered points: x = distance to the nearest, y = to the edge between it and the next, z = its id. */
  vec3 bCell(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    float id = 0.0;
    for (int x = -1; x <= 1; x++)
      for (int y = -1; y <= 1; y++)
        for (int z = -1; z <= 1; z++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 o = vec3(bHash(i + g), bHash(i + g + 11.3), bHash(i + g + 27.1));
          float d = length(g + o - f);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            id = bHash(i + g + 5.7);
          } else if (d < d2) {
            d2 = d;
          }
        }
    return vec3(d1, d2 - d1, id);
  }
`

/**
 * The ball's design, on the unit sphere it's made from: `u` round it (0-1), `v` up it
 * (-1..1). Then the PERFECT hit's fire round its edge (vBallS.z), and its own glow.
 */
const BALL_GLSL = /* glsl */ `
  {
    vec3 p = normalize(vBallP);
    float u = atan(p.z, p.x) / BTAU + 0.5;
    float v = p.y;
    vec3 A = diffuseColor.rgb;
    vec3 B = vBallB;
    vec3 C = vBallC;
    vec3 col = A;
    float glow = vBallS.y;
    int k = int(vBallS.x + 0.5);
    // The cell pattern (bCell, 27 lookups) is worked out once, at the scale this ball's
    // design wants, and only for the designs that use it: a compiler copies a function
    // into every place it's called, and four calls made this shader four times the size.
    vec3 cell = vec3(1.0, 1.0, 0.0);
    if (k == 3 || k == 5 || k == 9 || k == 12) {
      float cs = k == 3 ? 3.2 : (k == 5 ? 2.6 : (k == 9 ? 3.5 : 7.0));
      cell = bCell(p * cs);
    }
    if (k == 0) {
      // A band round its middle, edged in a third colour (sushi: rice, nori, salmon).
      col = mix(A, B, 1.0 - smoothstep(0.26, 0.31, abs(p.y)));
      col = mix(col, C, 1.0 - smoothstep(0.03, 0.06, abs(abs(p.y) - 0.31)));
    } else if (k == 1) {
      // Stripes from pole to pole.
      col = mix(A, B, smoothstep(0.3, 0.38, abs(fract(u * 6.0) - 0.5)));
    } else if (k == 2) {
      // A candy swirl.
      col = mix(A, B, step(0.5, fract(u * 4.0 + v * 1.4)));
    } else if (k == 3) {
      // Spots: chocolate chips, pepperoni, holes, speckles, bubbles.
      vec3 c = cell;
      col = mix(A, mix(B, C, step(0.7, c.z)), 1.0 - smoothstep(0.24, 0.3, c.x));
    } else if (k == 4) {
      // A citrus slice: segments round the core, pale pith between them and at the ends.
      float w = abs(fract(u * 8.0) - 0.5) * 2.0;
      float seam = max(smoothstep(0.84, 0.94, w), smoothstep(0.84, 0.92, abs(v)));
      col = mix(A * (0.85 + 0.25 * (1.0 - abs(v))), B, seam);
    } else if (k == 5) {
      // Lava: a dark crust split by glowing, pulsing cracks.
      vec3 c = cell;
      float crack = 1.0 - smoothstep(0.0, 0.09, c.y);
      float pulse = 0.7 + 0.3 * sin(uBTime * 3.0 + c.z * 6.0);
      col = mix(A, mix(B, C, 1.0 - smoothstep(0.0, 0.03, c.y)), crack);
      glow += crack * 1.3 * pulse;
    } else if (k == 6) {
      // A galaxy: swirling nebula and twinkling stars.
      float neb = 0.5 + 0.5 * sin(u * BTAU * 2.0 + v * 5.0 + sin(v * 7.0 + u * 9.0));
      col = mix(A, mix(B, C, 0.5 + 0.5 * sin(u * 20.0)), neb * 0.7);
      vec3 cell = floor(p * 36.0);
      float star = step(0.975, bHash(cell)) * (0.5 + 0.5 * sin(uBTime * 5.0 + bHash(cell + 3.1) * 30.0));
      col = mix(col, vec3(1.0), star);
      glow += 0.4 + star * 1.5;
    } else if (k == 7) {
      // Rainbow bands, flowing round it.
      col = mix(bHue(u + v * 0.4 + uBTime * 0.15), vec3(1.0), 0.15);
    } else if (k == 8) {
      // Scales, row on row, rimmed in gold.
      float row = floor(v * 6.0);
      vec2 q = vec2(fract(u * 14.0 + mod(row, 2.0) * 0.5) - 0.5, fract(v * 6.0) - 0.5);
      float d = length(q * vec2(1.0, 1.3));
      col = mix(A * (1.2 - d * 0.6), B, smoothstep(0.38, 0.48, d));
    } else if (k == 9) {
      // Cut facets, each its own shade, catching the light one after another.
      vec3 c = cell;
      col = mix(A, B, c.z) * (0.8 + 0.35 * fract(c.z * 7.0));
      col = mix(col, vec3(1.0), 1.0 - smoothstep(0.0, 0.05, c.y));
      float glint = step(0.85, fract(c.z * 13.0 + floor(uBTime * 2.0) * 0.37));
      col = mix(col, C, glint * 0.6);
      glow += 0.05 + glint * 0.5;
    } else if (k == 10) {
      // Wood grain rings.
      float n = sin(p.x * 7.0) * 0.15 + sin(p.z * 5.0 + p.y * 3.0) * 0.1;
      col = mix(A, B, smoothstep(0.55, 0.8, fract(length(p.xz) * 5.0 + n * 3.0 + p.y * 0.6)) * 0.8);
    } else if (k == 11) {
      // A sports ball's stitched seam.
      col = mix(A, B, 1.0 - smoothstep(0.03, 0.055, abs(v - 0.55 * sin(u * BTAU * 2.0))));
    } else if (k == 12) {
      // Icing and sprinkles.
      vec3 c = cell;
      vec3 sprinkle = c.z < 0.33 ? B : (c.z < 0.66 ? C : vec3(0.35, 0.9, 0.45));
      col = mix(A, sprinkle, 1.0 - smoothstep(0.22, 0.28, c.x));
    } else {
      // A coin: a raised rim and a ring, polished.
      float rim = smoothstep(0.74, 0.8, abs(p.y));
      float ring = 1.0 - smoothstep(0.02, 0.05, abs(abs(p.y) - 0.55));
      col = mix(A, B, max(rim * 0.6, ring));
      col *= 0.85 + 0.3 * smoothstep(-0.3, 0.8, p.y);
    }
    // A PERFECT hit: the ball burns, fire wrapping its edge.
    float edge = 1.0 - abs(normalize(vNormal).z);
    float fire = vBallS.z * (0.35 + edge * edge);
    col = mix(col, vec3(1.0, 0.5, 0.08), min(1.0, fire));
    glow += vBallS.z * (0.5 + edge);
    diffuseColor.rgb = col;
    totalEmissiveRadiance += col * (0.18 + glow);
  }
`

let material = null
/** The one material every ball uses. */
function ballMaterial() {
  if (!material) {
    // No emissive of its own: each ball brightens itself in its own colour (BALL_GLSL).
    material = new MeshToonMaterial({ color: '#ffffff', emissive: new Color('#000000') })
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${vertexHead}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexBody}`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${fragmentHead}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${BALL_GLSL}`)
      shader.uniforms.uBTime = glowTime
    }
    material.customProgramCacheKey = () => 'pong-ball-v2'
  }
  return material
}

/** The sphere: full, and a lighter one for balls seen small (the showroom's). */
const SPHERES = {}
function sphere(detail) {
  if (!SPHERES[detail]) {
    SPHERES[detail] = detail === 'lite' ? new SphereGeometry(1, 12, 8) : new SphereGeometry(1, 20, 14)
    SPHERES[detail].deleteAttribute('uv')
  }
  return SPHERES[detail]
}

/**
 * Up to `max` balls in one draw call. Place them with setMatrixAt, dress each one with
 * `setBall(index, paddleId, hot)` - `hot` for a PERFECT hit's fire - and set `.count`.
 * The sphere and material are shared: dispose the mesh and its own geometry only.
 */
export function createBallMesh(max, detail = 'full') {
  const base = sphere(detail)
  // Its own geometry object for its own per-instance attributes, sharing the sphere's buffers.
  const geometry = new BufferGeometry()
  geometry.setIndex(base.index)
  for (const name of ['position', 'normal']) geometry.setAttribute(name, base.getAttribute(name))
  geometry.boundingSphere = base.boundingSphere
  const b = new InstancedBufferAttribute(new Float32Array(max * 3), 3)
  const c = new InstancedBufferAttribute(new Float32Array(max * 3), 3)
  const style = new InstancedBufferAttribute(new Float32Array(max * 3), 3)
  geometry.setAttribute('aBallB', b)
  geometry.setAttribute('aBallC', c)
  geometry.setAttribute('aBallStyle', style)

  const mesh = new InstancedMesh(geometry, ballMaterial(), max)
  const dressed = new Array(max).fill(null)
  const hotness = new Array(max).fill(false)

  /** Dresses ball `i` as paddle `id`'s; cheap to call every frame. */
  mesh.setBall = (i, id, hot = false) => {
    if (dressed[i] === id && hotness[i] === hot) return
    dressed[i] = id
    hotness[i] = hot
    const s = styleOf(id)
    mesh.setColorAt(i, s.a)
    b.setXYZ(i, s.b.r, s.b.g, s.b.b)
    c.setXYZ(i, s.c.r, s.c.g, s.c.b)
    style.setXYZ(i, s.pattern, s.glow, hot ? 1 : 0)
    mesh.instanceColor.needsUpdate = true
    b.needsUpdate = true
    c.needsUpdate = true
    style.needsUpdate = true
  }
  // Colours exist from the start, so the shader is compiled with them once.
  for (let i = 0; i < max; i += 1) mesh.setBall(i, 'bicycle')
  mesh.count = 0
  mesh.frustumCulled = false
  return mesh
}

/** Frees a mesh made by createBallMesh (the shared sphere and material stay). */
export function disposeBallMesh(mesh) {
  mesh.geometry.dispose()
  mesh.dispose()
}
