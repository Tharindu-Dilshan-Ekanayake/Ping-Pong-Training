import { CylinderGeometry, SphereGeometry, TorusGeometry } from 'three'

import {
  COURT_BACK_X,
  COURT_HALF,
  PAD_COUNT,
  PAD_HEIGHT,
  PAD_RADIUS,
  PAD_X,
  padCenterZ,
  ROBOT_X,
  SHOP_SIGN,
  SHOP_SIGN_FACING,
  SHOP_STAGES,
  TABLE_HEIGHT,
  TABLE_LENGTH,
  TABLE_NEAR_X,
  TABLE_WIDTH,
  TABLE_X,
} from '@shared/world'

import { STYLE } from '../materials'

/**
 * Static lobby structures, added to the world's shared BlockSet and prop builder so they
 * render in the same few draw calls as the hills.
 */

/**
 * Per-pad look, in pad order (matches PADS in shared/balance.js): the mat's base, top,
 * glowing ring and centre emblem, the ping pong table's top beyond it, and the colour of
 * its labels.
 */
export const PAD_THEMES = [
  { base: '#1f5fc8', top: '#3f9cff', ring: '#9fe8ff', emblem: '#ffffff', table: '#1d5fd6', court: '#2c4fa8', blade: '#ff3b3b', text: '#5fd6ff' },
  { base: '#b8222e', top: '#ff3b3b', ring: '#ffd21f', emblem: '#1d1f22', table: '#1f9a4a', court: '#a8323c', blade: '#1d1f22', text: '#ff7a6a' },
  { base: '#d64a9a', top: '#ff8fd0', ring: '#ffffff', emblem: '#ffd23f', table: '#d63f8f', court: '#b8467e', blade: '#ffd23f', text: '#ff9cd6' },
  { base: '#1d3f8a', top: '#2f6fe0', ring: '#7fe2ff', emblem: '#ffd21f', table: '#173b8f', court: '#26408a', blade: '#ff3b3b', text: '#7fb8ff' },
  { base: '#5a2a9a', top: '#8a4cff', ring: '#ff7ad9', emblem: '#ffffff', table: '#6a2fd0', court: '#4a2a8a', blade: '#ffd21f', text: '#c69bff' },
  { base: '#1a8ab8', top: '#7ff0ff', ring: '#ffffff', emblem: '#9b6bff', table: '#14a3c9', court: '#1f7aa8', blade: '#9b6bff', text: '#9fe8ff', style: STYLE.GLOW },
  { base: '#1b2266', top: '#2a1450', ring: '#c35cff', emblem: '#ffd21f', table: '#2a1450', court: '#1b1f5c', blade: '#ffd21f', text: '#d39bff', style: STYLE.GALAXY },
]

const LINE = '#f4f7fb'
const LEG = '#3a3f4a'
const INK = '#1b1b1f'

const DISC = new CylinderGeometry(1, 1, 1, 24)
const RING = new TorusGeometry(1, 0.08, 4, 28)
const CYL = new CylinderGeometry(1, 1, 1, 12)
const BALL = new SphereGeometry(1, 12, 8)
const BEAD = new SphereGeometry(1, 6, 4)

/**
 * A pad's training court, west of its mat: a coloured floor with white lines, a low
 * barrier at the back, the ping pong table on two leg frames with a mesh net, and the
 * ball robot at the far end - a round head with big eyes, a launcher mouth, an antenna
 * and a hopper of balls - that rallies with you. Boxes go in `blocks`, the round parts
 * in `props`: no draw calls of their own.
 */
function buildCourt(blocks, props, z, theme) {
  const x = TABLE_X
  const half = TABLE_LENGTH / 2
  const side = TABLE_WIDTH / 2
  const top = TABLE_HEIGHT

  // The court's floor and its white border.
  const courtLength = COURT_BACK_X - (TABLE_NEAR_X - 0.4)
  const courtX = (TABLE_NEAR_X - 0.4 + COURT_BACK_X) / 2
  blocks.addOn(courtX, 0, z, courtLength, 0.05, COURT_HALF * 2, theme.court, STYLE.SMOOTH)
  for (const s of [-1, 1]) blocks.addOn(courtX, 0.05, z + s * (COURT_HALF - 0.15), courtLength - 0.3, 0.01, 0.12, LINE, STYLE.SMOOTH)
  blocks.addOn(COURT_BACK_X - 0.3, 0.05, z, 0.12, 0.01, COURT_HALF * 2 - 0.3, LINE, STYLE.SMOOTH)

  // The barrier across the back: panels in two colours with a glowing top.
  for (let i = 0; i < 3; i += 1) {
    const pz = z - COURT_HALF + (i + 0.5) * ((COURT_HALF * 2) / 3)
    blocks.addOn(COURT_BACK_X, 0, pz, 0.22, 0.75, (COURT_HALF * 2) / 3 - 0.06, i % 2 ? theme.top : '#1f2a5c', STYLE.SMOOTH)
  }
  blocks.addOn(COURT_BACK_X, 0.75, z, 0.26, 0.08, COURT_HALF * 2, theme.ring, STYLE.GLOW)

  // The table: top with white lines, a dark skirt under it.
  blocks.addOn(x, top - 0.12, z, TABLE_LENGTH, 0.12, TABLE_WIDTH, theme.table, theme.style ?? STYLE.SMOOTH)
  blocks.addOn(x, top - 0.3, z, TABLE_LENGTH - 0.3, 0.18, TABLE_WIDTH - 0.3, '#2a2f3a', STYLE.SMOOTH)
  for (const s of [-1, 1]) {
    blocks.addOn(x, top, z + s * (side - 0.05), TABLE_LENGTH, 0.015, 0.08, LINE, STYLE.SMOOTH)
    blocks.addOn(x + s * (half - 0.05), top, z, 0.08, 0.015, TABLE_WIDTH, LINE, STYLE.SMOOTH)
    // A leg frame at each end: two legs, a crossbar and wheels.
    const lx = x + s * (half - 0.55)
    for (const e of [-1, 1]) {
      blocks.addOn(lx, 0.12, z + e * (side - 0.35), 0.14, top - 0.42, 0.14, LEG, STYLE.SMOOTH)
      blocks.addOn(lx, 0, z + e * (side - 0.35), 0.22, 0.12, 0.22, INK, STYLE.SMOOTH)
    }
    blocks.addOn(lx, 0.32, z, 0.1, 0.1, TABLE_WIDTH - 0.7, LEG, STYLE.SMOOTH)
    // The net's posts, just outside the table's sides.
    blocks.addOn(x, top - 0.2, z + s * (side + 0.08), 0.08, 0.5, 0.08, LEG, STYLE.SMOOTH)
  }
  blocks.addOn(x, 0.55, z, TABLE_LENGTH - 1.1, 0.1, 0.1, LEG, STYLE.SMOOTH)
  blocks.addOn(x, top, z, TABLE_LENGTH, 0.015, 0.04, LINE, STYLE.SMOOTH)
  // The net: a mesh panel with a dark tape along its top.
  blocks.addOn(x, top, z, 0.03, 0.26, TABLE_WIDTH + 0.12, '#dfe7f2', STYLE.PLATE)
  blocks.addOn(x, top + 0.24, z, 0.06, 0.04, TABLE_WIDTH + 0.16, INK, STYLE.SMOOTH)

  // The ball robot.
  const rx = ROBOT_X
  props.add(CYL, { position: [rx, 0.06, z], scale: [0.6, 0.12, 0.6], color: LEG })
  props.add(CYL, { position: [rx, (top - 0.1) / 2 + 0.1, z], scale: [0.3, top - 0.1, 0.3], color: theme.base })
  props.add(BALL, { position: [rx, top + 0.42, z], scale: [0.62, 0.56, 0.62], color: theme.ring })
  // Big eyes looking at you (west), with dark pupils and a shine.
  for (const s of [-1, 1]) {
    props.add(BALL, { position: [rx - 0.48, top + 0.55, z + s * 0.21], scale: 0.16, color: '#ffffff' })
    props.add(BEAD, { position: [rx - 0.6, top + 0.55, z + s * 0.21], scale: 0.08, color: INK })
    props.add(BEAD, { position: [rx - 0.66, top + 0.59, z + s * 0.21 + 0.02], scale: 0.025, color: '#ffffff', style: STYLE.GLOW })
  }
  // The launcher mouth, pointing at you.
  props.add(CYL, { position: [rx - 0.5, top + 0.2, z], rotation: [0, 0, Math.PI / 2], scale: [0.15, 0.3, 0.15], color: INK })
  // Antenna with a glowing tip.
  props.add(CYL, { position: [rx + 0.05, top + 1.12, z], scale: [0.03, 0.4, 0.03], color: LEG })
  props.add(BEAD, { position: [rx + 0.05, top + 1.36, z], scale: 0.1, color: theme.emblem === '#1d1f22' ? '#ffd21f' : theme.emblem, style: STYLE.GLOW })
  // The hopper on its back, full of balls.
  props.add(CYL, { position: [rx + 0.42, top + 0.88, z], scale: [0.3, 0.32, 0.3], color: '#cfe8ff' })
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2
    props.add(BEAD, { position: [rx + 0.42 + Math.cos(a) * 0.15, top + 1.08, z + Math.sin(a) * 0.15], scale: 0.11, color: i % 2 ? '#ff9a1e' : '#ffffff' })
  }
}

/**
 * The training spots: round two-tier mats in the pad's colours, a glowing ring round the
 * top and a star emblem in the middle, each with its ping pong table beyond. The rounded
 * parts go into the world's props, the rest into its blocks: no draw calls of their own.
 */
export function buildPads(blocks, props) {
  for (let i = 0; i < PAD_COUNT; i += 1) {
    const theme = PAD_THEMES[i]
    const z = padCenterZ(i)
    const r = PAD_RADIUS
    props.add(DISC, { position: [PAD_X, PAD_HEIGHT * 0.4, z], scale: [r + 0.45, PAD_HEIGHT * 0.8, r + 0.45], color: theme.base })
    props.add(DISC, { position: [PAD_X, PAD_HEIGHT - 0.06, z], scale: [r, 0.14, r], color: theme.top, style: theme.style ?? STYLE.STUDS })
    props.add(RING, { position: [PAD_X, PAD_HEIGHT + 0.02, z], rotation: [Math.PI / 2, 0, 0], scale: [r - 0.25, r - 0.25, 1], color: theme.ring, style: STYLE.GLOW })
    // The mat's emblem: a paddle with a ball beside it.
    props.add(CYL, { position: [PAD_X + 0.35, PAD_HEIGHT + 0.03, z - 0.35], scale: [0.95, 0.05, 0.95], color: theme.blade })
    props.add(CYL, { position: [PAD_X + 0.35, PAD_HEIGHT + 0.02, z - 0.35], scale: [1.08, 0.04, 1.08], color: INK })
    blocks.add(PAD_X - 0.68, PAD_HEIGHT + 0.03, z + 0.68, 0.38, 0.06, 1.3, '#c98f52', STYLE.SMOOTH, -Math.PI / 4)
    props.add(CYL, { position: [PAD_X - 0.95, PAD_HEIGHT + 0.03, z - 1.05], scale: [0.36, 0.06, 0.36], color: '#ffffff' })
    buildCourt(blocks, props, z, theme)
  }
}

const WHITE = '#f4f7fb'
const BLUE = '#ff6a3d'
const NAVY = '#3a1f7a'
const SKY = '#ff9ee0'
const GOLD = '#ffd21f'

/**
 * The paddle showroom: two open display stages (the stands on them are TireShop's) and
 * the big sign behind, built like the start arch - white decks on an orange band with
 * pink light strips round the edges. `detail` (off on LOW) adds the sign's bulbs.
 *
 * No two faces here share a plane: every layer stands a clear step proud of what it
 * sits on.
 */
export function buildShop(blocks, { detail = true } = {}) {
  for (const s of SHOP_STAGES) {
    const w = s.maxX - s.minX
    const d = s.maxZ - s.minZ
    const cx = (s.minX + s.maxX) / 2
    const cz = (s.minZ + s.maxZ) / 2
    blocks.addOn(cx, -0.1, cz, w, s.height + 0.1, d, WHITE)
    blocks.addOn(cx, 0, cz, w + 0.3, s.height * 0.5, d + 0.3, BLUE)
    // Light strips along all four top edges, and a gold post at each corner.
    for (const side of [-1, 1]) {
      blocks.addOn(cx + side * (w / 2 - 0.25), s.height, cz, 0.35, 0.08, d - 1.4, SKY, STYLE.GLOW)
      blocks.addOn(cx, s.height, cz + side * (d / 2 - 0.25), w - 1.4, 0.08, 0.35, SKY, STYLE.GLOW)
      for (const end of [-1, 1]) {
        blocks.addOn(cx + side * (w / 2 - 0.35), s.height, cz + end * (d / 2 - 0.35), 0.6, 0.7, 0.6, GOLD, STYLE.GLOW)
      }
    }
  }

  // The sign: two striped legs, a purple panel in an orange frame, a gold cap, its face
  // turned to the plaza (`f`).
  const { x, minZ, maxZ, top } = SHOP_SIGN
  const f = SHOP_SIGN_FACING
  const length = maxZ - minZ
  const midZ = (minZ + maxZ) / 2
  const bottom = top - 8.2
  for (const z of [minZ + 1.5, maxZ - 1.5]) blocks.addOn(x - 0.1 * f, 0, z, 0.9, bottom + 0.3, 0.9, BLUE, STYLE.STRIPES)
  blocks.addOn(x, bottom, midZ, 0.6, top - bottom, length, BLUE)
  blocks.addOn(x + 0.1 * f, bottom + 0.5, midZ, 0.6, top - bottom - 1, length - 1, NAVY, STYLE.SMOOTH)
  blocks.addOn(x, top, midZ, 0.9, 0.4, length + 0.4, GOLD, STYLE.GLOW)
  if (detail) {
    for (let z = minZ + 1; z <= maxZ - 0.99; z += 1.5) {
      blocks.add(x + 0.42 * f, bottom + 0.25, z, 0.16, 0.3, 0.3, Math.round(z) % 2 ? '#ffffff' : GOLD, STYLE.GLOW)
      blocks.add(x + 0.42 * f, top - 0.25, z + 0.75, 0.16, 0.3, 0.3, Math.round(z) % 2 ? GOLD : '#ffffff', STYLE.GLOW)
    }
  }
}
