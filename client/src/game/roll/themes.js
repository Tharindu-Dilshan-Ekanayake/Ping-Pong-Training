import { STYLE } from '../materials'

/**
 * Each stage theme's colours (each stage names one in its `theme`): the sky the lane
 * flies under, the HUD's name gradient, and the floor/gate tints the dust and spray
 * effects borrow. The stages have no gates or canyon any more - only their sky, name
 * and pay rate change as the ball flies on.
 */
export const ZONE_THEMES = {
  grassy: {
    floor: '#c68656',
    wall: '#bf7f4e',
    ledge: '#58cf3a',
    gate: '#3fd13f',
    sky: ['#2f8ff2', '#a6d6fb'],
    name: ['#e6ffb0', '#8dff4f', '#2fd12f'],
  },
  desert: {
    floor: '#ecdc93',
    wall: '#e4d088',
    ledge: '#f5e6a8',
    gate: '#ffb12a',
    sky: ['#3a9ff0', '#f3e1ae'],
    name: ['#fffaa8', '#ffd52a', '#ff9c00'],
  },
  beach: {
    floor: '#f6e3a6',
    wall: '#e9cf8a',
    ledge: '#ffe8a8',
    gate: '#2fc6ff',
    sky: ['#1f9cf5', '#bdf0ff'],
    name: ['#e0fbff', '#5fe0ff', '#1a9cf0'],
  },
  frozen: {
    floor: '#bfe5ff',
    wall: '#a6d8fb',
    ledge: '#ffffff',
    gate: '#5cc8ff',
    sky: ['#57aef0', '#e4f4ff'],
    name: ['#ffffff', '#c9f1ff', '#5cc8ff'],
  },
  autumn: {
    floor: '#bb7a4c',
    wall: '#a86a40',
    ledge: '#f0952c',
    gate: '#ff7a1e',
    sky: ['#3d8fe0', '#f6d3a4'],
    name: ['#ffe2b0', '#ffa646', '#e8620c'],
  },
  candy: {
    floor: '#ffc2e2',
    wall: '#ffa8d6',
    ledge: '#fff2fa',
    gate: '#ff5fb8',
    sky: ['#7a8cff', '#ffd6f0'],
    name: ['#ffe6f6', '#ff9cd6', '#ff3fa8'],
  },
  volcano: {
    floor: '#433a3d',
    wall: '#352e31',
    ledge: '#5a4943',
    gate: '#ff4a1c',
    sky: ['#5a2a3a', '#d27a52'],
    name: ['#ffd0b0', '#ff7a3c', '#e2240c'],
  },
  crystal: {
    floor: '#5d44ad',
    wall: '#4a3394',
    ledge: '#8f6bff',
    gate: '#c08bff',
    sky: ['#2a1e6a', '#8a7ae0'],
    name: ['#f2e6ff', '#c69bff', '#8a3ee8'],
  },
  sky: {
    floor: '#f2f7ff',
    wall: '#dbe9ff',
    ledge: '#ffffff',
    gate: '#ffd84a',
    sky: ['#5fb8ff', '#fff4d6'],
    name: ['#ffffff', '#ffe98a', '#ffb21e'],
  },
  jungle: {
    floor: '#7a9a4a',
    wall: '#5f7a3a',
    ledge: '#2f9a3a',
    gate: '#3fd16a',
    sky: ['#2f9ad8', '#cfeec0'],
    name: ['#e6ffd0', '#7dff7a', '#1fa83a'],
  },
  cherry: {
    floor: '#f6d6e4',
    wall: '#e8b8cc',
    ledge: '#ffe0ee',
    gate: '#ff7ab8',
    sky: ['#7ab4ff', '#ffe4f0'],
    name: ['#fff0f8', '#ffa8d4', '#ff4f9a'],
  },
  mushroom: {
    floor: '#8a6a9a',
    wall: '#6f5280',
    ledge: '#7ad05a',
    gate: '#c46bff',
    sky: ['#5a6ad8', '#e0c8ff'],
    name: ['#f4e6ff', '#d29bff', '#9a3be8'],
  },
  swamp: {
    floor: '#6a8a5a',
    wall: '#4f6a44',
    ledge: '#5fb04a',
    gate: '#8ae04a',
    sky: ['#4a9ab8', '#d8f0c8'],
    name: ['#f0ffd8', '#b8f05a', '#5ab82a'],
  },
  ocean: {
    floor: '#f2e2b0',
    wall: '#3f9ac8',
    ledge: '#5fd0e8',
    gate: '#ff7a8a',
    sky: ['#1a6ad0', '#8ae8ff'],
    name: ['#e0fbff', '#7fe8ff', '#1a9cd8'],
  },
  neon: {
    floor: '#1d1d2e',
    floorStyle: STYLE.ROAD,
    wall: '#26263a',
    ledge: '#39ff88',
    ledgeStyle: STYLE.GLOW,
    gate: '#ff3bd8',
    sky: ['#120a30', '#5a2a8a'],
    name: ['#e6fff0', '#39ff88', '#1ab85a'],
  },
  rainbow: {
    floor: '#ffffff',
    floorStyle: STYLE.RAINBOW,
    wall: '#f4f0ff',
    ledge: '#ffffff',
    gate: '#ffd84a',
    sky: ['#6a8aff', '#ffe8f8'],
    name: ['#ffffff', '#ffb8f0', '#ff5fd2'],
  },
  moon: {
    floor: '#b8bcc8',
    wall: '#9a9eac',
    ledge: '#d8dce6',
    gate: '#5fc8ff',
    sky: ['#0a0a24', '#3a3a5a'],
    name: ['#ffffff', '#cfd8ea', '#7f8aa8'],
  },
  aurora: {
    floor: '#d8f0ff',
    wall: '#9ac8e8',
    ledge: '#ffffff',
    gate: '#5fffc8',
    sky: ['#0f2a5a', '#5ad8b8'],
    name: ['#e0fff4', '#7fffd0', '#2fc89a'],
  },
  cosmic: {
    floor: '#2a0f4a',
    floorStyle: STYLE.GALAXY,
    wall: '#3a1a6a',
    wallStyle: STYLE.GALAXY,
    ledge: '#ff5bd8',
    ledgeStyle: STYLE.GLOW,
    gate: '#ff5bd8',
    sky: ['#0a0018', '#3a0a4a'],
    name: ['#ffe6fb', '#ff9cf0', '#d43bc8'],
  },
  space: {
    floor: '#1b1f5c',
    floorStyle: STYLE.GALAXY,
    wall: '#262b70',
    wallStyle: STYLE.GALAXY,
    ledge: '#7a5cff',
    ledgeStyle: STYLE.GLOW,
    gate: '#8a63ff',
    sky: ['#05051a', '#241544'],
    name: ['#e6e0ff', '#a98bff', '#6a4cff'],
  },
}

/**
 * How each stage theme dresses the serve lane: the field's colour and pattern either
 * side of the rainbow lane, and the scenery standing along it (`prop`, one of Lane.jsx's
 * PROPS, in `colors`). Every stage looks like its own place, with no gate between them.
 */
export const STAGE_LOOKS = {
  grassy: { field: '#4fd63a', prop: 'tree', colors: ['#3fbf3a', '#7ae84a', '#ff5fa8'] },
  autumn: { field: '#d9b24a', prop: 'tree', colors: ['#ff8a2a', '#ffc13a', '#d8342a'] },
  desert: { field: '#f2d27a', prop: 'cactus', colors: ['#3fae4a', '#2f8f3a', '#ff5fa8'] },
  beach: { field: '#f6e3a6', prop: 'palm', colors: ['#3fd15a', '#8a5a2a', '#2fc6ff'] },
  jungle: { field: '#2fae4a', prop: 'palm', colors: ['#1f8f3a', '#7a4a24', '#ffd21f'] },
  frozen: { field: '#eef8ff', prop: 'snowman', colors: ['#ffffff', '#ff8a1e', '#2f6fe0'] },
  cherry: { field: '#8fdc6a', prop: 'tree', colors: ['#ffa8d4', '#ffd6ea', '#ffffff'] },
  candy: { field: '#ffc2e2', prop: 'lollipop', colors: ['#ff4fa8', '#ffffff', '#7fe2ff'] },
  mushroom: { field: '#7ccf5a', prop: 'mushroom', colors: ['#ff3b5c', '#ffffff', '#fff3e0'] },
  volcano: { field: '#4a2a24', style: 'LAVA', prop: 'lava', colors: ['#3a2420', '#ff6a1e', '#ffd21f'] },
  swamp: { field: '#6fae3a', prop: 'mushroom', colors: ['#8a4dff', '#d9c6ff', '#e8f0c8'] },
  crystal: { field: '#d6c8ff', prop: 'crystal', colors: ['#b98bff', '#7fe2ff', '#8a7aa8'] },
  ocean: { field: '#2fc0e8', style: 'WATER', prop: 'crystal', colors: ['#ff7a6a', '#ffb0c8', '#e8d29a'] },
  neon: { field: '#1d2246', prop: 'crystal', colors: ['#39ff88', '#ff3bd8', '#2a2f5a'] },
  sky: { field: '#e8f6ff', prop: 'cloud', colors: ['#ffffff', '#e0f0ff', '#ffffff'] },
  rainbow: { field: '#ffe6f6', prop: 'lollipop', colors: ['#ff5fd2', '#ffe23a', '#2fd0ff'] },
  moon: { field: '#b8bcc8', prop: 'crystal', colors: ['#d6dbe6', '#9aa0b0', '#6e7385'] },
  aurora: { field: '#c8fff0', prop: 'snowman', colors: ['#ffffff', '#5fffc8', '#7a5cff'] },
  space: { field: '#1b1f5c', style: 'GALAXY', prop: 'crystal', colors: ['#8a63ff', '#5fd6ff', '#3a2a7a'] },
  cosmic: { field: '#2a1450', style: 'GALAXY', prop: 'crystal', colors: ['#ff5bd8', '#ffd21f', '#4a1f7a'] },
}

/** The serve lane's rainbow bands, LANE_STRIPE metres each (Lane.jsx; Impact.jsx's chunks). */
export const LANE_STRIPE = 4
export const LANE_RAINBOW = ['#ff4a4a', '#ff9a1e', '#ffe23a', '#4be05a', '#2fd0ff', '#3a6bff', '#b05cff', '#ff5fd2']
