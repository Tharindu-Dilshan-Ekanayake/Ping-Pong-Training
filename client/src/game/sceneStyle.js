/**
 * The scene's whole look in one place: a ping pong arena under a sunset sky - a pale
 * blue studded court floor, orange running-track paths, sunny yellow aprons, and
 * grandstands in rainbow seat colours all round.
 *
 * Colours are sRGB hex, exactly as you would pick them in an image editor.
 *
 * Light intensities are three.js physical units: a light of intensity PI (~3.14)
 * lights a surface facing it to its full texture colour. The hemisphere fill plus the
 * sun add up to just over that on the ground, which is what keeps the greens vivid;
 * shadowed ground only gets the fill, so shadows read as a softer, darker green.
 */

export const SKY = {
  /** Straight up. */
  top: '#5a5cf0',
  /** At eye level. Fog uses the same colour so distant ground melts into the sky. */
  horizon: '#ffcbe9',
  /** Lower = the deep blue reaches further down towards the horizon. */
  exponent: 0.35,
}

export const FOG = {
  color: SKY.horizon,
}

export const CLOUDS = {
  /** Sunlit tops. */
  top: '#ffffff',
  /** Undersides, a warm pink-grey. */
  bottom: '#f2d6ea',
}

/** Every surface colour in the lobby. */
export const PALETTE = {
  plaza: '#bfe4ff',
  path: '#ff9a4a',
  pathEdge: '#e8642a',
  apron: '#ffe27a',
  apronEdge: '#fff6c8',
  shopFloor: '#efe2ff',
  lawn: '#66cf4b',
  sidewalk: '#dadada',
  dirt: '#c99a5f',
  trunk: '#7c4d29',
  leaves: ['#33cc3a', '#3fd63f', '#2ec236'],
  white: '#f4f7fb',
  water: '#4cc3ff',
  /** The grandstands: seat rows in these colours, tier by tier, under a white rail. */
  seats: ['#ff4f6a', '#ffb22e', '#3fc6ff', '#8a5cff'],
  standBase: '#3a2f6a',
  rail: '#ffffff',
  /** Flags along the top rows of the stands. */
  flags: ['#ff4f6a', '#ffd23a', '#3fc6ff', '#4be05a', '#ff5fd2'],
}

export const LIGHTS = {
  /** Fill from above (sky) and below (bounce off the grass). */
  hemiSky: '#ffffff',
  hemiGround: '#c8bfd8',
  hemiIntensity: 2.1,

  sunColor: '#fff6e8',
  sunIntensity: 1.65,
  /**
   * Direction *towards* the sun: high and a little to the left, behind the default
   * camera, so the side of the character you look at is lit and its shadow falls
   * beside it where you can see it, not hidden behind its back.
   */
  sunDirection: [-0.35, 0.9, 0.25],
  /** 1 = shadows get no sunlight at all; lower = lighter shadows. */
  shadowIntensity: 0.7,
  /** Blur radius of shadow edges, in shadow-map texels. */
  shadowSoftness: 3,
}
