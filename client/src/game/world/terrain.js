import { hash2 } from '@shared/rng'
import { PLAZA } from '@shared/world'

import { STYLE } from '../materials'
import { PALETTE } from '../sceneStyle'

/**
 * The grandstands ringing the plaza, like a ping pong arena: rows of seats stepping up
 * and back from the plaza's edge, each row in the next seat colour under a white rail,
 * on a dark base, with flags along the top. The serve lane leaves northwards through a
 * gap in them.
 *
 * Heights are sampled on a coarse grid (a row every CELL metres out from the plaza) and
 * greedy-merged into as few boxes as possible: because every row is one height all the
 * way round, the whole ring is a few hundred boxes, not thousands.
 */

const CELL = 4
const BOUNDS = { minX: -176, maxX: 156, minZ: -150, maxZ: 136 }
/** The serve lane leaves the plaza northwards through this gap in the stands. */
const CORRIDOR_HALF_WIDTH = 34
/** Each row of seats is this much higher than the one in front of it. */
const RISE = 2
/** The front row's height, and the top row's. */
const FRONT = 2
const TOP = 30

/**
 * How far (x, z) is outside `rect`, measured square (the larger of the two axes), so
 * rows run straight along each side and meet at the corners, like a real stadium's.
 */
function squareOutside(rect, x, z) {
  return Math.max(rect.minX - x, 0, x - rect.maxX, rect.minZ - z, z - rect.maxZ)
}

const CORRIDOR = { minX: -CORRIDOR_HALF_WIDTH, maxX: CORRIDOR_HALF_WIDTH, minZ: -10000, maxZ: PLAZA.minZ }

/** Height of the stands at a cell centre, or 0 where the ground is open. */
export function terrainHeight(x, z) {
  const d = Math.min(squareOutside(PLAZA, x, z), squareOutside(CORRIDOR, x, z))
  if (d <= 0) return 0
  return Math.min(TOP, FRONT + Math.floor(d / CELL) * RISE)
}

/** The seat colour of the row whose top is at `h`. */
const seatColor = (h) => PALETTE.seats[Math.floor(h / RISE) % PALETTE.seats.length]

/**
 * A flag on a pole standing on `base`: a white pole and a coloured pennant, turned to
 * fly the same way as every other.
 */
function addFlag(blocks, x, base, z, color) {
  blocks.addOn(x, base, z, 0.3, 5, 0.3, PALETTE.rail, STYLE.SMOOTH)
  blocks.addOn(x + 1, base + 3.6, z, 1.8, 1.2, 0.12, color, STYLE.SMOOTH)
  blocks.addOn(x, base + 5, z, 0.5, 0.5, 0.5, '#ffd23a', STYLE.GLOW)
}

/** Builds the grandstands into `blocks`; returns how many flags were placed (for tests/debug). */
export function buildTerrain(blocks, { treeDensity = 1 } = {}) {
  const cols = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / CELL)
  const rows = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / CELL)
  const heights = new Int16Array(cols * rows)
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = BOUNDS.minX + (i + 0.5) * CELL
      const z = BOUNDS.minZ + (j + 0.5) * CELL
      heights[j * cols + i] = terrainHeight(x, z)
    }
  }

  // Greedy merge: runs along X, then stack identical runs along Z.
  const open = new Map()
  const emit = (run) => {
    const width = (run.i1 - run.i0 + 1) * CELL
    const depth = (run.j1 - run.j0 + 1) * CELL
    const x = BOUNDS.minX + run.i0 * CELL + width / 2
    const z = BOUNDS.minZ + run.j0 * CELL + depth / 2
    // The row's block on the dark base (sunk a little so no seam shows at the ground),
    // its seats on top, and a white rail along the seats' front.
    blocks.addOn(x, -0.5, z, width, run.h - 0.1, depth, PALETTE.standBase, STYLE.SMOOTH)
    blocks.addOn(x, run.h - 0.6, z, width, 0.6, depth, seatColor(run.h), STYLE.STUDS)
  }
  for (let j = 0; j < rows; j += 1) {
    const runs = []
    let i = 0
    while (i < cols) {
      const h = heights[j * cols + i]
      if (h === 0) {
        i += 1
        continue
      }
      let i1 = i
      while (i1 + 1 < cols && heights[j * cols + i1 + 1] === h) i1 += 1
      runs.push({ i0: i, i1, h })
      i = i1 + 1
    }

    const nextOpen = new Map()
    for (const run of runs) {
      const key = `${run.i0}:${run.i1}:${run.h}`
      const prev = open.get(key)
      if (prev) {
        prev.j1 = j
        nextOpen.set(key, prev)
        open.delete(key)
      } else {
        nextOpen.set(key, { ...run, j0: j, j1: j })
      }
    }
    for (const run of open.values()) emit(run)
    open.clear()
    for (const [key, run] of nextOpen) open.set(key, run)
  }
  for (const run of open.values()) emit(run)

  // The front row's white rail, along each side of the plaza (not across the lane).
  const { minX, maxX, minZ, maxZ } = PLAZA
  blocks.addOn((minX + maxX) / 2, FRONT, maxZ + 0.3, maxX - minX, 0.6, 0.3, PALETTE.rail, STYLE.GLOW)
  for (const side of [-1, 1]) {
    const x = side > 0 ? maxX + 0.3 : minX - 0.3
    blocks.addOn(x, FRONT, (minZ + maxZ) / 2, 0.3, 0.6, maxZ - minZ, PALETTE.rail, STYLE.GLOW)
    const cx = side * (CORRIDOR_HALF_WIDTH + (maxX - CORRIDOR_HALF_WIDTH) / 2)
    blocks.addOn(cx, FRONT, minZ - 0.3, maxX - CORRIDOR_HALF_WIDTH, 0.6, 0.3, PALETTE.rail, STYLE.GLOW)
  }

  // Flags along the top rows, every few metres; fewer on LOW.
  let flags = 0
  const every = treeDensity < 0.5 ? 6 : 3
  for (let j = 1; j < rows - 1; j += 1) {
    for (let i = 1; i < cols - 1; i += 1) {
      const h = heights[j * cols + i]
      if (h !== TOP - RISE * 2) continue
      if ((i + j) % every !== 0 || hash2(i, j, 77) > 0.6) continue
      const x = BOUNDS.minX + (i + 0.5) * CELL
      const z = BOUNDS.minZ + (j + 0.5) * CELL
      addFlag(blocks, x, h, z, PALETTE.flags[(i * 7 + j) % PALETTE.flags.length])
      flags += 1
    }
  }
  return { flags }
}
