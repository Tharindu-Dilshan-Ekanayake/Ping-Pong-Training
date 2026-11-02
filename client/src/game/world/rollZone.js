import { CylinderGeometry, SphereGeometry, TorusGeometry } from 'three'

import { ROLL_ARCH, ROLL_ZONE } from '@shared/world'

import { STYLE } from '../materials'

const WHITE = '#f4f7fb'
const BLUE = '#ff6a3d'
const NAVY = '#3a1f7a'
const SKY = '#ff9ee0'
const GOLD = '#ffd21f'

const DISC = new CylinderGeometry(1, 1, 1, 28)
const RIM = new TorusGeometry(1, 0.1, 8, 36)
const BALL = new SphereGeometry(1, 16, 12)

/** Height of the arch's beam, and the ROLL! sign hung on its face. */
const ARCH_TOP = 11
export const ARCH_SIGN = { width: 12, height: 3, y: ARCH_TOP - 1.6, faceZ: ROLL_ARCH.z + 1.05 }

/**
 * The start of the lane: the purple SERVE ZONE across its mouth (painted with its name,
 * see signs.js), a glowing pink pad at each end, and a big start arch over it in orange
 * and purple with a SERVE! sign, crowned by a giant paddle and ball.
 *
 * Boxes go into the world's block set and the round parts into its props, so the whole
 * thing rides in those two draw calls. `detail` (off on LOW) adds the bulbs.
 *
 * No two faces here share a plane: every layer stands a clear step proud of what it
 * sits on (flush faces flicker, worst on phones' coarser depth buffers).
 */
export function buildRollZone(blocks, props, { detail = true } = {}) {
  const { minX, maxX, minZ, maxZ } = ROLL_ZONE
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  const w = maxX - minX
  const d = maxZ - minZ

  // The strip: a pink border with the purple fill raised on it, running right up to the
  // lane's edge.
  blocks.addOn(cx, 0, cz + 0.3, w + 1.2, 0.05, d + 0.6, '#ff5fd2')
  blocks.addOn(cx, 0.05, cz + 0.3, w, 0.05, d - 0.2, '#8a6bff')
  // Chevrons on the strip, pointing down the lane.
  for (const x of [-9, 9]) {
    for (const side of [-1, 1]) {
      blocks.add(x + side * 0.7, 0.12, cz, 2.2, 0.04, 0.6, GOLD, STYLE.SMOOTH, side * 0.75)
    }
  }
  // Glowing pink pads at both ends.
  for (const side of [-1, 1]) {
    const x = side * (w / 2 + 2.2)
    props.add(DISC, { position: [x, 0.08, cz + 0.3], scale: [2, 0.12, 2.6], color: '#fff0fa' })
    props.add(DISC, { position: [x, 0.15, cz + 0.3], scale: [1.6, 0.06, 2.2], color: '#ff5fd2', style: STYLE.GLOW })
  }

  // The start arch: striped pillars either side, a beam across the top carrying the
  // ROLL! sign and a rainbow crest, and a glowing orb on each pillar.
  const archZ = ROLL_ARCH.z
  const span = ROLL_ARCH.x * 2
  for (const side of [-1, 1]) {
    const x = side * ROLL_ARCH.x
    blocks.addOn(x, 0, archZ, 2.2, 0.8, 2.2, NAVY)
    blocks.addOn(x, 0.8, archZ, 1.6, ARCH_TOP - 0.8, 1.6, BLUE, STYLE.STRIPES)
    blocks.addOn(x, ARCH_TOP + 1.3, archZ, 2.1, 2.1, 2.1, GOLD, STYLE.GLOW)
    if (detail) {
      for (let y = 1.8; y < ARCH_TOP - 0.6; y += 1.1) {
        blocks.add(x, y, archZ + 0.88, 0.3, 0.3, 0.16, Math.round(y) % 2 ? '#ffffff' : GOLD, STYLE.GLOW)
      }
    }
  }
  blocks.addOn(0, ARCH_TOP - 0.2, archZ, span + 1, 1.5, 1.3, BLUE, STYLE.STRIPES)
  blocks.addOn(0, ARCH_TOP - 0.45, archZ, span - 1.4, 0.25, 1.4, SKY, STYLE.GLOW)
  blocks.addOn(0, ARCH_TOP + 1.3, archZ, span - 4, 0.3, 1, '#ffffff', STYLE.RAINBOW)
  // The ROLL! sign: a navy panel in a blue frame, lettering painted on (signs.js).
  blocks.addOn(0, ARCH_SIGN.y - ARCH_SIGN.height / 2 - 0.15, archZ + 0.75, ARCH_SIGN.width + 0.6, ARCH_SIGN.height + 0.3, 0.3, BLUE)
  blocks.addOn(0, ARCH_SIGN.y - ARCH_SIGN.height / 2, archZ + 0.8, ARCH_SIGN.width, ARCH_SIGN.height, 0.3, NAVY, STYLE.SMOOTH)
  if (detail) {
    for (let x = -ROLL_ARCH.x + 1.5; x <= ROLL_ARCH.x - 1.49; x += 1) {
      if (Math.abs(x) < ARCH_SIGN.width / 2 + 0.7) continue
      blocks.add(x, ARCH_TOP + 0.95, archZ + 0.73, 0.3, 0.3, 0.16, Math.round(x) % 2 ? GOLD : '#ffffff', STYLE.GLOW)
      blocks.add(x + 0.5, ARCH_TOP + 0.15, archZ + 0.73, 0.3, 0.3, 0.16, Math.round(x) % 2 ? '#ffffff' : GOLD, STYLE.GLOW)
    }
  }

  // The crown: a giant ping pong paddle standing on its handle on the beam, its red face
  // to the plaza, with a giant ball beside it, and a gold ring glowing round the blade.
  const bladeY = ARCH_TOP + 7.2
  blocks.addOn(0, ARCH_TOP + 1.4, archZ, 1, 2.6, 0.8, '#c98f52', STYLE.SMOOTH)
  blocks.addOn(0, ARCH_TOP + 2.2, archZ, 1.15, 0.3, 0.95, WHITE, STYLE.SMOOTH)
  props.add(DISC, { position: [0, bladeY, archZ], rotation: [Math.PI / 2, 0, 0], scale: [3.4, 0.5, 3.4], color: '#1d1f22' })
  props.add(DISC, { position: [0, bladeY, archZ + 0.05], rotation: [Math.PI / 2, 0, 0], scale: [3.15, 0.55, 3.15], color: '#ff3b3b' })
  props.add(RIM, { position: [0, bladeY, archZ - 0.1], scale: [3.9, 3.9, 3], color: GOLD, style: STYLE.GLOW })
  props.add(BALL, { position: [4.6, ARCH_TOP + 4.6, archZ + 0.6], scale: 1.5, color: '#ffffff' })
  props.add(DISC, { position: [4.6, ARCH_TOP + 4.6, archZ + 0.6], rotation: [0, 0, 0.5], scale: [1.52, 0.3, 1.52], color: '#ff9a1e' })
}
