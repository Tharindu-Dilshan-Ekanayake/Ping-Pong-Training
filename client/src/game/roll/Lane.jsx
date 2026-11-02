import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CanvasTexture, Color, Euler, InstancedBufferAttribute, InstancedMesh, LinearFilter, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, Vector3 } from 'three'

import { zoneIndexAt } from '@shared/logic'

import { getQuality } from '../../store/quality'
import { BlockSet, disposeBlocks } from '../blocks'
import { sharedMaterials, STYLE } from '../materials'
import { activeWorld, zones } from '../worldLook'
import { SLOPE_EULER_X, slopeBoxMatrix, trackPoint } from './path'
import { roll } from './rollControl'
import { LANE_RAINBOW, LANE_STRIPE, STAGE_LOOKS, ZONE_THEMES } from './themes'

/**
 * The serve lane, as in the reference: a rainbow lane down the middle of an open field,
 * every metre count painted on it ("1,344 m"), running on forever downhill. Each stage
 * dresses the field its own way (STAGE_LOOKS) - meadow, sand, snow, candy, lava,
 * galaxy... - with its own scenery along the lane and a glowing line across the lane
 * where it starts. No gates.
 *
 * Nothing is built per stretch of track. A fixed set of pieces - field squares, STRIPES
 * rainbow bands, PROP_SLOTS pieces of scenery and a pool of number glyphs - is moved
 * along to wherever you're looking (the ball in flight, the start from the lobby) and
 * recoloured for the stage it lands in. Four draw calls, the same at 60 m or 16 km, and
 * nothing allocated while it runs.
 */

const STRIPE = LANE_STRIPE
const RAINBOW = LANE_RAINBOW
/** Bands drawn at once: a multiple of RAINBOW's length, so each band keeps its colour as it's reused. */
const STRIPES = 128
export const LANE_WIDTH = 18
const FIELD_WIDTH = 280
/** The field and lane start this far behind the focus (never before the start line). */
const BEHIND = 40
const FIELD_LENGTH = STRIPES * STRIPE
/** The field is laid in squares this long, each in its stage's look. */
const SEGMENT = 8
const SEGMENTS = FIELD_LENGTH / SEGMENT
/** Field boxes: the squares, the lane's two edge lines, then the stage-start lines. */
const EDGE = SEGMENTS
const STAGE_LINE = SEGMENTS + 2
const STAGE_LINES = 4

/** Scenery: one piece every PROP_EVERY metres, alternating sides; each up to PARTS boxes. */
const PROP_EVERY = 10
const PROP_SLOTS = Math.ceil(FIELD_LENGTH / PROP_EVERY) + 2
const PARTS = 4
const BROWN = '#8a5a2a'
const GLOW = STYLE.GLOW
/**
 * Scenery pieces as boxes: [x, y (centre), z, width, height, depth, colour, style, turn].
 * Colour 0-2 picks from the stage's `colors`; a string is a colour of its own.
 */
const PROPS = {
  tree: [
    [0, 1.5, 0, 0.8, 3, 0.8, BROWN],
    [0, 4, 0, 3.6, 2.8, 3.6, 0],
    [0, 6, 0, 2.2, 1.6, 2.2, 1],
    [2, 0.4, 0.6, 1.2, 0.8, 1.2, 2],
  ],
  cactus: [
    [0, 2.5, 0, 1.2, 5, 1.2, 0],
    [1, 3.1, 0, 0.8, 1.8, 0.8, 1],
    [-1, 2.4, 0, 0.8, 1.6, 0.8, 1],
    [0, 5.2, 0, 0.6, 0.4, 0.6, 2],
  ],
  palm: [
    [0, 3, 0, 0.7, 6, 0.7, 1],
    [0, 6.1, 0, 5.4, 0.4, 1.3, 0],
    [0, 6.1, 0, 1.3, 0.4, 5.4, 0],
    [0.5, 5.6, 0.4, 0.8, 0.8, 0.8, 2],
  ],
  snowman: [
    [0, 1.1, 0, 2.6, 2.2, 2.6, 0],
    [0, 3, 0, 1.9, 1.7, 1.9, 0],
    [0, 4.4, 0, 1.3, 1.2, 1.3, 0],
    [0, 5.2, 0, 1.4, 0.35, 1.4, 2],
  ],
  lollipop: [
    [0, 2, 0, 0.35, 4, 0.35, '#ffffff'],
    [0, 4.8, 0, 2.8, 2.8, 0.7, 0],
    [0, 4.8, 0, 2.9, 0.6, 0.75, 1],
    [0, 0.15, 0, 1.2, 0.3, 1.2, 2],
  ],
  mushroom: [
    [0, 1.3, 0, 1.2, 2.6, 1.2, 2],
    [0, 3.2, 0, 4, 1.3, 4, 0],
    [0, 4.05, 0, 2.6, 0.5, 2.6, 0],
    [0.9, 4.35, 0.5, 0.8, 0.2, 0.8, 1],
  ],
  crystal: [
    [0, 2.2, 0, 1.2, 4.5, 1.2, 0, GLOW, 0.6],
    [1.3, 1.5, 0.3, 0.9, 3, 0.9, 1, GLOW, 0.2],
    [-1.1, 1.2, -0.2, 0.8, 2.4, 0.8, 0, GLOW, 1.1],
    [0, 0.3, 0, 3.2, 0.7, 2.6, 2],
  ],
  lava: [
    [0, 1, 0, 3, 2, 2.6, 0],
    [1.9, 0.7, 0.5, 2, 1.4, 2, 0],
    [0, 1.25, 0, 3.1, 0.25, 2.7, 1, GLOW],
    [0.4, 2.4, 0, 0.6, 0.6, 0.6, 2, GLOW, 0.7],
  ],
  cloud: [
    [0, 5, 0, 4.4, 1.7, 2.6, 0],
    [-2, 4.6, 0.3, 2.6, 1.4, 2, 1],
    [2.1, 4.7, -0.2, 2.6, 1.5, 2.1, 1],
    [0.4, 6, 0, 2.4, 1.2, 1.8, 2],
  ],
}

/** Parsed colours, by hex, so recolouring allocates nothing once warmed up. */
const colorCache = new Map()
function colorOf(hex) {
  let c = colorCache.get(hex)
  if (!c) {
    c = new Color(hex)
    colorCache.set(hex, c)
  }
  return c
}
const lookAt = (meter) => STAGE_LOOKS[zones()[zoneIndexAt(meter)].theme] ?? STAGE_LOOKS.grassy
/** A stable pseudo-random 0-1 for scenery piece `k` (and a salt): the same on every client. */
function hash(k, salt) {
  let h = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2d)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

/** A distance painted across the lane every MARK_EVERY metres. */
const MARK_EVERY = 12
const MAX_GLYPHS = 300
/** Glyph cells in the atlas, and their size on the lane (metres). */
const CHARS = '0123456789,m'
const COMMA = 10
const UNIT = 11
const GLYPH_W = 1.7
const GLYPH_H = 2.6
const ADVANCE = { digit: 1.45, comma: 0.7, space: 0.8 }
const FONT = '"Fredoka One", "Arial Rounded MT Bold", sans-serif'

/** Glyphs lie flat on the slope, upright as read from behind (looking down the lane). */
const FLAT = new Quaternion().setFromEuler(new Euler(-Math.PI / 2 + SLOPE_EULER_X, 0, 0))
const _m = new Matrix4()
const _p = new Vector3()
const _s = new Vector3()
const _o = new Vector3()
const _q = new Quaternion()
const _up = new Vector3(0, 1, 0)
const ZERO = new Matrix4().makeScale(0, 0, 0)
/** One label's glyph cells, reused: at most "99,999,999 m". */
const label = new Int8Array(16)

/** Writes the glyph cells of "1,344 m" for metre `n` into `label`; returns how many. */
function spell(n) {
  let digits = 0
  let count = 0
  // Digits right to left, a comma every three, then turned round in place.
  do {
    if (digits > 0 && digits % 3 === 0) label[count++] = COMMA
    label[count++] = n % 10
    n = Math.floor(n / 10)
    digits += 1
  } while (n > 0 && count < 13)
  for (let i = 0, j = count - 1; i < j; i += 1, j -= 1) {
    const t = label[i]
    label[i] = label[j]
    label[j] = t
  }
  return count
}

/** The atlas: each character white with a soft dark edge, in its own cell. */
function glyphAtlas(size) {
  const cell = size / 16
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = Math.round(cell * 1.6)
  const texture = new CanvasTexture(canvas)
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  const draw = () => {
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = `${Math.round(canvas.height * 0.8)}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    for (let i = 0; i < CHARS.length; i += 1) {
      const x = (i + 0.5) * cell
      const y = canvas.height * 0.54
      ctx.lineWidth = canvas.height * 0.08
      ctx.strokeStyle = 'rgba(30, 40, 90, 0.35)'
      ctx.strokeText(CHARS[i], x, y)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(CHARS[i], x, y)
    }
    texture.needsUpdate = true
  }
  draw()
  document.fonts?.load(`64px ${FONT}`).then(draw, () => null)
  return texture
}

const glyphVertex = /* glsl */ `
  attribute float aGlyph;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = vec2((aGlyph + uv.x) / 16.0, uv.y);
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`
const glyphFragment = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uFar;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vec4 t = texture2D(uAtlas, vUv);
    // Fades out far down the lane rather than shimmering into mush.
    float a = t.a * 0.9 * (1.0 - smoothstep(uFar * 0.6, uFar, vDepth));
    if (a < 0.02) discard;
    gl_FragColor = vec4(t.rgb, a);
    #include <colorspace_fragment>
  }
`

function createGlyphs() {
  const atlas = glyphAtlas(Math.min(512, getQuality().maxTexture || 512))
  const geometry = new PlaneGeometry(1, 1)
  const glyph = new InstancedBufferAttribute(new Float32Array(MAX_GLYPHS), 1)
  geometry.setAttribute('aGlyph', glyph)
  const material = new ShaderMaterial({
    uniforms: { uAtlas: { value: atlas }, uFar: { value: 300 } },
    vertexShader: glyphVertex,
    fragmentShader: glyphFragment,
    transparent: true,
    depthWrite: false,
  })
  const mesh = new InstancedMesh(geometry, material, MAX_GLYPHS)
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.renderOrder = 1
  mesh.userData.atlas = atlas
  return mesh
}

/** The field's squares, the two white lines along the lane's edges, and the stage lines. */
function createField() {
  const set = new BlockSet()
  for (let i = 0; i < SEGMENTS; i += 1) set.add(0, 0, 0, 1, 1, 1, '#4fd63a', STYLE.CHECKER)
  for (let i = 0; i < 2 + STAGE_LINES; i += 1) set.add(0, 0, 0, 1, 1, 1, '#ffffff', STYLE.GLOW)
  const mesh = set.build(sharedMaterials().blocks)
  mesh.frustumCulled = false
  return mesh
}

/** The scenery's boxes, PARTS to a piece, placed and coloured as pieces come into view. */
function createProps() {
  const set = new BlockSet()
  for (let i = 0; i < PROP_SLOTS * PARTS; i += 1) set.add(0, 0, 0, 0, 0, 0, '#ffffff', STYLE.SMOOTH)
  const mesh = set.build(sharedMaterials().blocks)
  mesh.frustumCulled = false
  return mesh
}

/**
 * Places scenery piece `k` (PROP_EVERY metres apart, alternating sides) in its slot: its
 * stage's kind of piece in the stage's colours, at a random distance from the lane, size
 * and turn - the same on every client. With `sparse` (LOW) half of them are left out.
 */
function placeProp(mesh, styles, k, sparse) {
  const slot = (k % PROP_SLOTS) * PARTS
  const metre = k * PROP_EVERY + PROP_EVERY / 2
  const look = lookAt(metre)
  const parts = PROPS[look.prop] ?? PROPS.tree
  const side = k % 2 ? 1 : -1
  const skip = sparse && k % 4 >= 2
  const x = side * (LANE_WIDTH / 2 + 5 + hash(k, 1) * 36)
  const size = 0.8 + hash(k, 2) * 0.9
  const turn = hash(k, 3) * Math.PI * 2
  trackPoint(metre, x, -0.2, _p)
  for (let i = 0; i < PARTS; i += 1) {
    const part = parts[i]
    if (!part || skip) {
      mesh.setMatrixAt(slot + i, ZERO)
      continue
    }
    const [px, py, pz, sx, sy, sz, color, style = STYLE.SMOOTH, partTurn = 0] = part
    _q.setFromAxisAngle(_up, turn)
    _o.set(px * size, py * size, pz * size).applyQuaternion(_q).add(_p)
    _q.setFromAxisAngle(_up, turn + partTurn)
    mesh.setMatrixAt(slot + i, _m.compose(_o, _q, _s.set(sx * size, sy * size, sz * size)))
    mesh.setColorAt(slot + i, colorOf(typeof color === 'number' ? look.colors[color] : color))
    styles[slot + i] = style
  }
}

function createStripes() {
  const set = new BlockSet()
  for (let i = 0; i < STRIPES; i += 1) set.add(0, 0, 0, 1, 1, 1, RAINBOW[i % RAINBOW.length], STYLE.SMOOTH)
  const mesh = set.build(sharedMaterials().blocks)
  mesh.frustumCulled = false
  return mesh
}

export default function Lane() {
  const fieldRef = useRef(null)
  const stripesRef = useRef(null)
  const propsRef = useRef(null)
  const glyphsRef = useRef(null)
  /**
   * What the pieces were last laid out for: the first band, the first marker, the world,
   * the scenery density, and which scenery piece each slot holds.
   */
  const laidFor = useRef({ band: -1, mark: -1, far: 0, world: -1, sparse: false, slots: new Int32Array(PROP_SLOTS).fill(-1) })
  const assets = useMemo(() => ({ field: createField(), stripes: createStripes(), props: createProps(), glyphs: createGlyphs() }), [])

  useEffect(
    () => () => {
      disposeBlocks(assets.field)
      disposeBlocks(assets.stripes)
      disposeBlocks(assets.props)
      assets.glyphs.geometry.dispose()
      assets.glyphs.material.dispose()
      assets.glyphs.userData.atlas.dispose()
      assets.glyphs.dispose()
    },
    [assets],
  )

  useFrame(() => {
    const field = fieldRef.current
    const stripes = stripesRef.current
    const props = propsRef.current
    const glyphs = glyphsRef.current
    if (!field || !stripes || !props || !glyphs) return
    const focus = roll.active ? Math.max(0, roll.meter) : 0
    const laid = laidFor.current
    const band = Math.floor(Math.max(0, focus - BEHIND) / STRIPE)
    const world = activeWorld()
    const sparse = getQuality().decorDensity < 0.5
    if (world !== laid.world || sparse !== laid.sparse) {
      // Another world's stages, or another density of scenery: lay everything afresh.
      laid.world = world
      laid.sparse = sparse
      laid.band = -1
      laid.slots.fill(-1)
    }

    if (band !== laid.band) {
      laid.band = band
      const from = band * STRIPE
      const mid = from + FIELD_LENGTH / 2
      // The field's squares, each in the look of the stage it's in.
      const fieldStyles = field.geometry.getAttribute('aStyle')
      const first = Math.floor(from / SEGMENT)
      for (let j = first; j < first + SEGMENTS; j += 1) {
        const slot = j % SEGMENTS
        const look = lookAt(j * SEGMENT + SEGMENT / 2)
        field.setMatrixAt(slot, slopeBoxMatrix(j * SEGMENT + SEGMENT / 2, 0, -0.5, FIELD_WIDTH, 1, SEGMENT, 0, _m))
        field.setColorAt(slot, colorOf(look.field))
        fieldStyles.array[slot] = look.style ? STYLE[look.style] : STYLE.CHECKER
      }
      for (let side = 0; side < 2; side += 1) {
        field.setMatrixAt(EDGE + side, slopeBoxMatrix(mid, (side ? 1 : -1) * (LANE_WIDTH / 2 + 0.35), 0.03, 0.7, 0.06, FIELD_LENGTH, 0, _m))
      }
      // A glowing line across the lane where each stage starts, in its colour.
      const stages = zones()
      let line = 0
      for (let i = 1; i < stages.length && line < STAGE_LINES; i += 1) {
        const start = stages[i].start
        if (start < from || start > from + FIELD_LENGTH) continue
        field.setMatrixAt(STAGE_LINE + line, slopeBoxMatrix(start, 0, 0.06, LANE_WIDTH + 2, 0.08, 1.4, 0, _m))
        field.setColorAt(STAGE_LINE + line, colorOf(ZONE_THEMES[stages[i].theme].gate))
        line += 1
      }
      for (; line < STAGE_LINES; line += 1) field.setMatrixAt(STAGE_LINE + line, ZERO)
      field.instanceMatrix.needsUpdate = true
      field.instanceColor.needsUpdate = true
      fieldStyles.needsUpdate = true

      // Scenery coming into view takes the slots of the pieces left behind.
      const propStyles = props.geometry.getAttribute('aStyle')
      const k0 = Math.floor(from / PROP_EVERY)
      let placed = false
      for (let k = k0; k < k0 + PROP_SLOTS; k += 1) {
        if (laid.slots[k % PROP_SLOTS] === k) continue
        laid.slots[k % PROP_SLOTS] = k
        placeProp(props, propStyles.array, k, sparse)
        placed = true
      }
      if (placed) {
        props.instanceMatrix.needsUpdate = true
        props.instanceColor.needsUpdate = true
        propStyles.needsUpdate = true
      }
      // Each band index k always lands on instance k % STRIPES, so its colour never changes.
      for (let k = band; k < band + STRIPES; k += 1) {
        stripes.setMatrixAt(k % STRIPES, slopeBoxMatrix(k * STRIPE + STRIPE / 2, 0, 0.02, LANE_WIDTH, 0.04, STRIPE, 0, _m))
      }
      stripes.instanceMatrix.needsUpdate = true
    }

    // The painted distances, from just behind the focus to as far as the preset sees.
    const far = Math.min(getQuality().viewDistance, 420)
    const mark = Math.max(1, Math.floor((focus - 20) / MARK_EVERY))
    if (mark === laid.mark && far === laid.far) return
    laid.mark = mark
    laid.far = far
    glyphs.material.uniforms.uFar.value = far
    const cells = glyphs.geometry.getAttribute('aGlyph')
    let n = 0
    for (let k = mark; k * MARK_EVERY < focus + far && n < MAX_GLYPHS - 16; k += 1) {
      const metre = k * MARK_EVERY
      const count = spell(metre)
      let width = ADVANCE.space + ADVANCE.digit
      for (let i = 0; i < count; i += 1) width += label[i] === COMMA ? ADVANCE.comma : ADVANCE.digit
      let x = -width / 2
      for (let i = 0; i <= count; i += 1) {
        const cell = i < count ? label[i] : UNIT
        const advance = cell === COMMA ? ADVANCE.comma : ADVANCE.digit
        if (i === count) x += ADVANCE.space
        trackPoint(metre, x + advance / 2, 0.07, _p)
        glyphs.setMatrixAt(n, _m.compose(_p, FLAT, _s.set(GLYPH_W, GLYPH_H, 1)))
        cells.setX(n, cell)
        n += 1
        x += advance
      }
    }
    glyphs.count = n
    glyphs.instanceMatrix.needsUpdate = true
    cells.needsUpdate = true
  })

  return (
    <>
      <primitive ref={fieldRef} object={assets.field} />
      <primitive ref={stripesRef} object={assets.stripes} />
      <primitive ref={propsRef} object={assets.props} />
      <primitive ref={glyphsRef} object={assets.glyphs} />
    </>
  )
}
