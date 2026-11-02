/**
 * The player's body language, shared by the Bloxity avatar and the blocky stand-in so
 * both move the same way.
 *
 * `computePose` turns the motion state into joint angles; each avatar applies them to
 * its own limbs. Angles are radians in character space (the character faces +Z, its
 * left side is +X), about each joint's pivot:
 *   swing - about X: negative swings a limb forward (arm up in front, knee up)
 *   sway  - about Z: positive moves a limb towards +X
 *   twist - about Y: positive turns the right shoulder forward
 * `lift` raises (or, to keep bent legs on the ground, lowers) the body, in metres.
 */

export const POSED_BONES = [
  'Spine1',
  'Neck1',
  'ArmL1',
  'ArmL2',
  'ArmR1',
  'ArmR2',
  'LegL1',
  'LegL2',
  'LegR1',
  'LegR2',
]

/** Written by `computePose` every frame; one shared result, never reallocated. */
export const pose = {
  lift: 0,
  bones: Object.fromEntries(POSED_BONES.map((name) => [name, { swing: 0, sway: 0, twist: 0 }])),
}

/** Sway sign that moves a limb away from the body, per side. */
const OUT_L = 1
const OUT_R = -1

const clamp01 = (x) => Math.min(1, Math.max(0, x))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Adds to a joint, scaled by weight `w`. */
function add(name, swing, sway, twist, w) {
  const b = pose.bones[name]
  b.swing += swing * w
  b.sway += sway * w
  b.twist += twist * w
}

/** Relaxed stance: arms hanging a little out from the sides, knees soft, breathing. */
function stance(w, time) {
  const breath = Math.sin(time * 1.8)
  add('LegL1', -0.04, 0.06 * OUT_L, 0, w)
  add('LegL2', 0.08, 0, 0, w)
  add('LegR1', 0.04, 0.06 * OUT_R, 0, w)
  add('LegR2', 0.08, 0, 0, w)
  add('Spine1', -0.03 + breath * 0.015, 0, 0, w)
  add('ArmL1', -0.08 + breath * 0.03, 0.14 * OUT_L, 0, w)
  add('ArmL2', -0.25, 0, 0, w)
  add('ArmR1', -0.08 + breath * 0.03, 0.14 * OUT_R, 0, w)
  add('ArmR2', -0.25, 0, 0, w)
  pose.lift += (-0.01 + breath * 0.006) * w
}

/**
 * Walk to sprint: arms and legs swing against each other, the body leans in and bobs
 * once per step. `phase` advances faster with speed, so the steps quicken.
 */
function stride(phase, ratio) {
  const cycle = Math.sin(phase)
  const leg = 0.85 * ratio
  const arm = 0.75 * ratio
  add('LegL1', cycle * leg, 0, 0, 1)
  add('LegR1', -cycle * leg, 0, 0, 1)
  // Knees fold on the back swing only.
  add('LegL2', Math.max(0, -cycle) * 1.1 * ratio, 0, 0, 1)
  add('LegR2', Math.max(0, cycle) * 1.1 * ratio, 0, 0, 1)
  add('ArmL1', -cycle * arm, 0.08 * OUT_L * ratio, 0, 1)
  add('ArmR1', cycle * arm, 0.08 * OUT_R * ratio, 0, 1)
  add('ArmL2', -(0.35 + Math.max(0, -cycle) * 0.5) * ratio, 0, 0, 1)
  add('ArmR2', -(0.35 + Math.max(0, cycle) * 0.5) * ratio, 0, 0, 1)
  add('Spine1', -(0.08 + 0.14 * ratio) * ratio, 0, cycle * 0.12 * ratio, 1)
  pose.lift += (Math.abs(Math.cos(phase)) * 0.05 - 0.015) * ratio
}

/**
 * In the air: one knee up and the arms out on the way up; falling, the legs straighten
 * and reach down for the ground.
 */
function airborne(vy) {
  const f = smooth(0, 1, clamp01((2 - vy) / 9))
  add('LegL1', lerp(-1.3, -0.35, f), 0.08 * OUT_L, 0, 1)
  add('LegL2', lerp(1.6, 0.25, f), 0, 0, 1)
  add('LegR1', lerp(0.25, -0.1, f), 0.08 * OUT_R, 0, 1)
  add('LegR2', lerp(0.5, 0.2, f), 0, 0, 1)
  add('ArmL1', lerp(-0.35, -0.6, f), lerp(1.15, 1.45, f) * OUT_L, 0, 1)
  add('ArmL2', -0.35, 0, 0, 1)
  add('ArmR1', lerp(-0.25, -0.5, f), lerp(1.05, 1.35, f) * OUT_R, 0, 1)
  add('ArmR2', -0.4, 0, 0, 1)
  add('Spine1', lerp(-0.15, 0.06, f), 0, 0, 1)
}

/**
 * Lying face down on the board, head first (the body itself is turned prone by its
 * holder; this is the pose within that): hands down gripping the rails, legs straight
 * out behind, chest and head lifted to see where you're going. Rattles a little at speed.
 */
function prone(time, speed, w = 1) {
  const rattle = Math.min(1, speed / 80) * 0.05
  const shake = Math.sin(time * 37) * rattle
  add('Spine1', -0.16, 0, 0, w)
  add('Neck1', -0.95, 0, 0, w)
  add('ArmL1', -1.35 + shake, 0.42 * OUT_L, 0, w)
  add('ArmL2', -0.7, 0, 0, w)
  add('ArmR1', -1.35 - shake, 0.42 * OUT_R, 0, w)
  add('ArmR2', -0.7, 0, 0, w)
  add('LegL1', 0.08 + shake, 0.1 * OUT_L, 0, w)
  add('LegL2', 0.12, 0, 0, w)
  add('LegR1', 0.08 - shake, 0.1 * OUT_R, 0, w)
  add('LegR2', 0.12, 0, 0, w)
}

/**
 * The launch, `t` 0..1 (the holder moves and turns the body; this is the pose within):
 * crouch down with the arms swung back, spring into a dive with both arms stretched
 * out ahead, and settle into the riding grip as you land on the board.
 */
function launching(t, time) {
  const crouch = smooth(0, 0.3, t) * (1 - smooth(0.38, 0.52, t))
  const dive = smooth(0.38, 0.55, t) * (1 - smooth(0.82, 1, t))
  add('LegL1', -0.75, 0.08 * OUT_L, 0, crouch)
  add('LegL2', 1.35, 0, 0, crouch)
  add('LegR1', -0.75, 0.08 * OUT_R, 0, crouch)
  add('LegR2', 1.35, 0, 0, crouch)
  add('Spine1', -0.45, 0, 0, crouch)
  add('Neck1', 0.25, 0, 0, crouch)
  add('ArmL1', 0.95, 0.15 * OUT_L, 0, crouch)
  add('ArmR1', 0.95, 0.15 * OUT_R, 0, crouch)
  add('ArmL2', -0.35, 0, 0, crouch)
  add('ArmR2', -0.35, 0, 0, crouch)
  pose.lift -= 0.32 * crouch

  add('ArmL1', -2.95, 0.12 * OUT_L, 0, dive)
  add('ArmR1', -2.95, 0.12 * OUT_R, 0, dive)
  add('LegL1', 0.18, 0.06 * OUT_L, 0, dive)
  add('LegR1', 0.18, 0.06 * OUT_R, 0, dive)
  add('Spine1', 0.12, 0, 0, dive)
  add('Neck1', -0.5, 0, 0, dive)

  prone(time, 0, smooth(0.8, 1, t))
}

/**
 * Where in the serve (0-1) the paddle meets the ball: the ball sets off at that moment
 * (roll/path.js, KICK_HIT). (Named for the template's kick, which this swing replaced.)
 */
export const KICK_IMPACT = 0.52

/**
 * A big forehand, `t` 0..1, with `impact` where the paddle meets the ball and `size`
 * how big a swing (1 for a serve, less for a rally): the paddle arm swings out and back
 * with the shoulders turned away, then whips round and through the ball with the body
 * turning into it, and follows through across the chest before settling. The other arm
 * points out for balance.
 */
function forehand(t, impact, size, w) {
  const wind = smooth(0, impact - 0.12, t) * (1 - smooth(impact - 0.12, impact, t))
  const strike = smooth(impact - 0.12, impact, t) * (1 - smooth(impact + 0.12, 1, t))
  const through = smooth(impact, impact + 0.18, t) * (1 - smooth(0.7, 1, t))
  const plant = smooth(0, 0.3, t) * (1 - smooth(0.85, 1, t))
  // The paddle arm: out to the side and back, then round and through.
  add('ArmR1', 0.2 * size, 1.15 * OUT_R, -0.9 * size, wind * w)
  add('ArmR2', -0.35, 0, 0, wind * w)
  add('ArmR1', -0.55 * size, 1.05 * OUT_R, 0.7 * size, strike * w)
  add('ArmR2', -0.15, 0, 0, strike * w)
  add('ArmR1', -0.5 * size, 0.2 * OUT_R, 0.9 * size, through * w)
  add('ArmR2', -0.9 * size, 0, 0, through * w)
  // Shoulders: turned away, then into it.
  add('Spine1', 0.05, 0, -0.35 * size, wind * w)
  add('Spine1', -0.12 * size, 0, 0.35 * size, strike * w)
  // The other arm out for balance.
  add('ArmL1', -0.6 * size, 0.55 * OUT_L, 0, plant * w)
  add('ArmL2', -0.4, 0, 0, plant * w)
  // Knees bend into it.
  add('LegL1', -0.18 * size, 0.05 * OUT_L, 0, plant * w)
  add('LegL2', 0.36 * size, 0, 0, plant * w)
  add('LegR1', 0.12 * size, 0.08 * OUT_R, 0, plant * w)
  add('LegR2', 0.3 * size, 0, 0, plant * w)
  pose.lift += -0.06 * size * plant * w
}

/** The serve: one big forehand through the tossed ball, over ROLL_LAUNCH. */
function servePose(t, w) {
  forehand(t, KICK_IMPACT, 1, w)
}

/**
 * Rallying at a training table, `h` 0..1 through each TRAIN_INTERVAL: a quick, smaller
 * forehand every cycle, meeting the ball at RALLY_IMPACT (pong.js times the ball to it).
 */
export const RALLY_IMPACT = 0.3
function rallyPose(h, w) {
  forehand(h, RALLY_IMPACT, 0.75, w)
}

/** Up in the air for a jump smash: knees tucked up, the free arm thrown high. */
function tuck(w) {
  add('LegL1', -1.0, 0.1 * OUT_L, 0, w)
  add('LegL2', 1.5, 0, 0, w)
  add('LegR1', -0.55, 0.1 * OUT_R, 0, w)
  add('LegR2', 1.2, 0, 0, w)
  add('ArmL1', -1.2, 0.4 * OUT_L, 0, w)
}

/** Holding the paddle ready: forearm up in front, the paddle out ahead. */
function grip(w) {
  add('ArmR1', -0.35, 0.12 * OUT_R, 0.15, w)
  add('ArmR2', -0.85, 0, 0, w)
}

/** In the air off a ramp: arms flung out like wings, legs kicking apart. */
function flying(time, w) {
  const flap = Math.sin(time * 9) * 0.12
  add('ArmL1', 1.05, 1.15 * OUT_L + flap, 0, w)
  add('ArmR1', 1.05, 1.15 * OUT_R - flap, 0, w)
  add('ArmL2', 0.4, 0, 0, w)
  add('ArmR2', 0.4, 0, 0, w)
  add('LegL1', -0.35, 0.18 * OUT_L, 0, w)
  add('LegR1', 0.2, 0.18 * OUT_R, 0, w)
  add('LegL2', 0.5, 0, 0, w)
  add('Neck1', -0.2, 0, 0, w)
}

/** Arms up and waving, bouncing on the spot: the celebration once you've stopped. */
function cheering(time, w) {
  const wave = Math.sin(time * 10) * 0.28
  add('ArmL1', -2.7 + wave, 0.38 * OUT_L, 0, w)
  add('ArmR1', -2.7 - wave, 0.38 * OUT_R, 0, w)
  add('ArmL2', -0.25, 0, 0, w)
  add('ArmR2', -0.25, 0, 0, w)
  add('LegL1', -0.12, 0.06 * OUT_L, 0, w)
  add('LegR1', -0.12, 0.06 * OUT_R, 0, w)
  add('LegL2', 0.22, 0, 0, w)
  add('LegR2', 0.22, 0, 0, w)
  add('Spine1', 0.1, 0, 0, w)
  add('Neck1', -0.15, 0, 0, w)
  pose.lift += Math.abs(Math.sin(time * 7)) * 0.16 * w
}

/**
 * @param {{ time?: number, speed?: number, maxSpeed?: number, grounded?: boolean,
 *   vy?: number, stride?: number, sliding?: boolean, launch?: number, stand?: number,
 *   air?: number, kick?: number, hit?: number, emote?: string|null }} motion
 *   `kick` (0-1) is the serve's swing and `leap` how high it has jumped for it (metres);
 *   `hit` (0-1, below 0 for none) the rally swing
 *   at a training table, each TRAIN_INTERVAL.
 *   `sliding` lies the body down on the board; `speed` is then the slide's speed.
 *   While sliding, `launch` (0-1) is the dive onto the board, `air` (0-1) how far into
 *   a jump's pose, and `stand` (0-1) getting up to celebrate at the end.
 *   `emote` is a Boxity emote id to play over this pose, or null. It isn't posed here:
 *   the Bloxity avatar blends the emote clip on top of this pose (avatarRig.updateEmote),
 *   so the same motion object drives both. `emoteFromAnim(r.anim)` in bloxity/emotes.js
 *   turns another player's synced anim ('emote:<id>') into this field.
 */
export function computePose(motion) {
  const {
    time = 0,
    speed = 0,
    maxSpeed = 6,
    grounded = true,
    vy = 0,
    stride: phase = time * 5,
    sliding = false,
    launch = 1,
    stand = 0,
    air = 0,
    kick = -1,
    hit = -1,
    leap = 0,
  } = motion
  for (const name of POSED_BONES) {
    const b = pose.bones[name]
    b.swing = 0
    b.sway = 0
    b.twist = 0
  }
  pose.lift = 0

  if (sliding) {
    if (launch < 1) launching(launch, time)
    else {
      prone(time, speed, 1 - stand)
      if (air > 0) flying(time, air)
      if (stand > 0) cheering(time, stand)
    }
    return pose
  }
  // Serving (`kick` 0-1 through the swing, below 0 or above 1 for none): eased in and
  // out over the stance.
  const kicking = kick >= 0 && kick <= 1
  const kickWeight = kicking ? smooth(0, 0.1, kick) * (1 - smooth(0.9, 1, kick)) : 0
  if (kicking) {
    stance(1 - kickWeight, time)
    grip(1 - kickWeight)
    servePose(kick, kickWeight)
    // Off the ground for a jump smash: tucked up as high as the leap goes.
    if (leap > 0) tuck(Math.min(1, leap / 0.8) * kickWeight)
  } else if (hit >= 0 && grounded) {
    // Rallying at a table: a swing every cycle, in the ready stance.
    stance(1, time)
    grip(0.6)
    rallyPose(hit, 1)
  } else if (grounded) {
    const ratio = clamp01(speed / Math.max(maxSpeed, 0.001))
    const still = 1 - smooth(0.05, 0.4, ratio)
    stance(still, time)
    grip(still)
    if (ratio > 0.02) stride(phase, ratio)
  } else {
    airborne(vy)
  }
  return pose
}
