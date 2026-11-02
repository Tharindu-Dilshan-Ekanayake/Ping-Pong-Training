import { createMusic } from './music'

/**
 * Sound effects and the background music, synthesised with WebAudio: no audio files
 * to download.
 *
 * Browsers only allow audio after a user gesture. The audio engine (AudioContext, echo,
 * noise, music) is built while the game loads (prepareAudio), where it costs nothing
 * anyone sees - built on the first tap instead, it froze whatever that tap did. It
 * starts suspended; the first tap/click/key resumes it and starts the music, and every
 * sound before that is silently skipped.
 */

const MUTE_KEY = 'pp.muted'
/** Master gain at full volume; everything is mixed to sit under this. */
const BASE_GAIN = 0.5

let ctx = null
let master = null
/** Input of the echo the chimes ring out into (see createEcho). */
let echo = null
let noiseBuffer = null
let music = null
/** The player's own mute button (persisted). */
let muted = readMuted()
/**
 * Muted for a Boxity ad break. Kept apart from `muted` so the break ending restores
 * whatever the player had chosen, never overwrites it.
 */
let adMuted = false
/** Boxity's master_volume / music_volume settings, 0..1 (not persisted: Boxity keeps them). */
let masterVolume = 1
let musicVolume = 1
const lastPlayed = new Map()
const muteListeners = new Set()

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

const silent = () => muted || adMuted

function applyMaster() {
  if (master) master.gain.value = silent() ? 0 : BASE_GAIN * masterVolume
}

/**
 * Builds the audio engine, suspended: the context, the master gain, the echo, the noise
 * and the music. Call while loading (GameScene does); the first gesture then only has
 * to resume it. Safe to call again.
 */
export function prepareAudio() {
  if (ctx) return
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return
  ctx = new Ctor()
  // Created outside a gesture it starts suspended anyway; make sure of it until a tap.
  if (ctx.state === 'running') ctx.suspend()
  master = ctx.createGain()
  applyMaster()
  master.connect(ctx.destination)
  echo = createEcho()
  // One second of white noise, reused by every whoosh and crack.
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  music = createMusic(ctx, master, noiseBuffer)
  music.setVolume(musicVolume)
}

let musicStarted = false
function unlock() {
  // Built already while loading, normally; on the spot if a tap beat it to it.
  prepareAudio()
  if (!ctx) return
  if (!musicStarted) {
    musicStarted = true
    music.start()
  }
  if (adMuted) ctx.suspend()
  else if (ctx.state === 'suspended') ctx.resume()
}

/**
 * A short, darkening echo for the chimes to ring out into, so they sparkle instead of
 * clicking off. Built once; every sound sent to it shares it.
 */
function createEcho() {
  const input = ctx.createGain()
  input.gain.value = 0.25
  const delay = ctx.createDelay(1)
  delay.delayTime.value = 0.13
  const damp = ctx.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = 3200
  const feedback = ctx.createGain()
  feedback.gain.value = 0.32
  input.connect(delay)
  delay.connect(damp).connect(feedback).connect(delay)
  damp.connect(master)
  return input
}

/** Installs the first-gesture unlock. Call once at startup. */
export function installAudioUnlock() {
  const events = ['pointerdown', 'keydown', 'touchend']
  const handler = () => {
    unlock()
    for (const e of events) window.removeEventListener(e, handler, true)
  }
  for (const e of events) window.addEventListener(e, handler, true)
  // Mobile browsers suspend audio in the background; resume on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx?.state === 'suspended' && !adMuted) ctx.resume()
  })
}

export function isMuted() {
  return muted
}

export function setMuted(value) {
  muted = value
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0')
  } catch {
    // Not persisted; fine.
  }
  applyMaster()
  for (const listener of muteListeners) listener(muted)
}

const clampVolume = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1)

/** Overall volume 0..1 (Boxity's master_volume setting). */
export function setMasterVolume(volume) {
  masterVolume = clampVolume(volume)
  applyMaster()
}

/** Music volume 0..1 (Boxity's music_volume setting), on top of the master volume. */
export function setMusicVolume(volume) {
  musicVolume = clampVolume(volume)
  music?.setVolume(musicVolume)
}

/**
 * Silences everything for a Boxity ad break, and suspends the audio clock so the music
 * scheduler doesn't pile notes up behind it. Ending the break restores the player's
 * own mute choice and volumes exactly as they were.
 */
export function setAdBreakMuted(on) {
  adMuted = Boolean(on)
  applyMaster()
  if (!ctx) return
  if (adMuted) ctx.suspend()
  else if (ctx.state === 'suspended' && document.visibilityState === 'visible') ctx.resume()
}

/** Calls `listener(muted)` on every change; returns the unsubscribe. */
export function onMutedChange(listener) {
  muteListeners.add(listener)
  return () => muteListeners.delete(listener)
}

// --- The roll: the sound of the tire rumbling down the track ----------------------------

let ride = null
let rideSetAt = 0

/**
 * One looping noise source through three bands: the rush of air (swelling with speed,
 * loudest in the air), the tire rumbling over the ground (its bumps quickening with
 * speed, silent in the air) and the hiss of its tread scrubbing (up as it skids). The
 * music ducks under it until `windStop`.
 */
function windStart() {
  if (!ctx || ride || ctx.state !== 'running') return
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer
  src.loop = true
  const band = (type, frequency, q) => {
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = frequency
    filter.Q.value = q
    const gain = ctx.createGain()
    gain.gain.value = 0.0001
    src.connect(filter).connect(gain).connect(master)
    return { filter, gain }
  }
  const air = band('bandpass', 400, 0.7)
  const rumble = band('lowpass', 220, 0.9)
  const carve = band('highpass', 3800, 0.7)
  // Bumps in the ground: the rumble's loudness wobbles, faster the faster you go.
  const bumps = ctx.createOscillator()
  bumps.frequency.value = 7
  const depth = ctx.createGain()
  depth.gain.value = 0
  bumps.connect(depth).connect(rumble.gain.gain)
  bumps.start()
  src.start()
  ride = { src, bumps, depth, air, rumble, carve }
  music?.duck(true)
}

/**
 * `level` 0..1 from the tire's speed down the track; `airborne` off a ramp; `skid` its
 * sideways skid (radians). Positional, not an object: it's called every frame.
 */
function windSet(level, airborne = false, skid = 0) {
  if (!ride) return
  // Ten updates a second is plenty for a smooth swell.
  const now = performance.now()
  if (now - rideSetAt < 100) return
  rideSetAt = now
  const t = ctx.currentTime
  const l = Math.min(1, Math.max(0, level))
  const ground = airborne ? 0 : 1
  ride.air.gain.gain.setTargetAtTime(0.03 + l * (airborne ? 0.26 : 0.17), t, 0.2)
  ride.air.filter.frequency.setTargetAtTime(320 + l * 2400 + (airborne ? 500 : 0), t, 0.25)
  const rumble = ground * (0.04 + l * 0.14)
  ride.rumble.gain.gain.setTargetAtTime(rumble, t, 0.08)
  ride.depth.gain.setTargetAtTime(rumble * 0.6, t, 0.08)
  ride.rumble.filter.frequency.setTargetAtTime(160 + l * 380, t, 0.2)
  ride.bumps.frequency.setTargetAtTime(6 + l * 16, t, 0.2)
  ride.carve.gain.gain.setTargetAtTime(ground * (0.008 + l * 0.03 + Math.min(1, Math.abs(skid)) * 0.06), t, 0.1)
}

function windStop() {
  if (!ride) return
  const { src, bumps, depth, air, rumble, carve } = ride
  ride = null
  const t = ctx.currentTime
  air.gain.gain.setTargetAtTime(0.0001, t, 0.3)
  rumble.gain.gain.setTargetAtTime(0.0001, t, 0.3)
  carve.gain.gain.setTargetAtTime(0.0001, t, 0.3)
  depth.gain.setTargetAtTime(0, t, 0.3)
  src.stop(t + 1.5)
  bumps.stop(t + 1.5)
  music?.duck(false)
}

function ready(name, minGapMs = 0) {
  if (!ctx || silent() || ctx.state !== 'running') return false
  const now = performance.now()
  if (minGapMs && now - (lastPlayed.get(name) || 0) < minGapMs) return false
  lastPlayed.set(name, now)
  return true
}

/** A short enveloped oscillator note; `echo` also sends it into the echo. */
function tone(freq, { type = 'sine', at = 0, duration = 0.12, volume = 0.3, slideTo = null, attack = 0.01, echo: wet = false } = {}) {
  const t = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration)
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(volume, t + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.connect(gain).connect(master)
  if (wet) gain.connect(echo)
  osc.start(t)
  osc.stop(t + duration + 0.02)
}

/** A struck bell: the note, a quieter octave and a glassy strike, ringing into the echo. */
function bell(freq, { at = 0, volume = 0.1, decay = 0.4 } = {}) {
  tone(freq, { at, duration: decay, volume, echo: true })
  tone(freq * 2, { at, duration: decay * 0.6, volume: volume * 0.35, echo: true })
  tone(freq * 3.01, { type: 'triangle', at, duration: 0.05, volume: volume * 0.3 })
}

/** Trophy chimes climb and fall this scale while they keep coming (C major pentatonic). */
const TROPHY_SCALE = [1047, 1175, 1319, 1568, 1760, 2093, 2349, 2637]
/** A trophy within this long of the last carries the run on; otherwise it starts again. */
const TROPHY_RUN_MS = 700
let trophyRun = 0
let trophyAt = 0

/** Filtered noise: whooshes and cracks. */
function noise({ at = 0, duration = 0.3, volume = 0.25, from = 400, to = 2400, q = 1.2 } = {}) {
  const t = ctx.currentTime + at
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = q
  filter.frequency.setValueAtTime(from, t)
  filter.frequency.exponentialRampToValueAtTime(to, t + duration)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(volume, t + duration * 0.3)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  src.connect(filter).connect(gain).connect(master)
  // Looped, so a long one from a random spot never runs off the end of the second.
  src.loop = true
  src.start(t, Math.random() * 0.5)
  src.stop(t + duration + 0.02)
}

export const sfx = {
  click() {
    if (ready('click', 40)) tone(660, { type: 'triangle', duration: 0.05, volume: 0.15 })
  },
  /** A Health gain: a bright tick, softer for the ones that trickle in while you train. */
  gain(soft = false) {
    if (ready('gain', 110)) tone(880 + Math.random() * 120, { type: 'triangle', duration: 0.07, volume: soft ? 0.05 : 0.07, slideTo: 1400 })
  },
  levelUp() {
    if (!ready('levelUp')) return
    ;[523, 659, 784, 1047].forEach((f, i) => tone(f, { type: 'square', at: i * 0.07, duration: 0.14, volume: 0.09 }))
  },
  /** Your tire setting off down the track: a kick, a whoosh, a rising boing and a sparkle. */
  rollStart() {
    if (!ready('rollStart')) return
    tone(110, { duration: 0.18, volume: 0.16, slideTo: 55 })
    noise({ duration: 0.7, volume: 0.3, from: 250, to: 3000, q: 0.8 })
    tone(220, { type: 'triangle', duration: 0.32, volume: 0.09, slideTo: 660 })
    bell(1319, { at: 0.2, volume: 0.05, decay: 0.3 })
  },
  /** The leg swinging back and through, just before the kick lands: a quick swish. */
  kickSwing() {
    if (ready('kickSwing', 200)) noise({ duration: 0.22, volume: 0.1, from: 600, to: 2200, q: 0.7 })
  },
  /** The paddle smashing the serve: a crisp tok over a fat thump. */
  kick() {
    if (!ready('kick', 200)) return
    tone(130, { duration: 0.2, volume: 0.22, slideTo: 48 })
    tone(1500, { duration: 0.05, volume: 0.22, slideTo: 1050 })
    tone(3100, { type: 'triangle', duration: 0.025, volume: 0.06 })
    noise({ duration: 0.04, volume: 0.18, from: 4200, to: 2400, q: 1.4 })
  },
  /**
   * The ball slamming into the lane from the top of its arc (`power` 0-1, how high it
   * fell): a deep boom, the ground cracking open, then rubble pattering down.
   */
  groundSmash(power = 1) {
    if (!ready('groundSmash', 400)) return
    const p = 0.6 + 0.4 * power
    tone(95, { duration: 0.75, volume: 0.34 * p, slideTo: 30 })
    tone(52, { type: 'triangle', duration: 0.6, volume: 0.2 * p, slideTo: 28 })
    noise({ duration: 0.55, volume: 0.34 * p, from: 1400, to: 110, q: 0.7 })
    noise({ duration: 0.11, volume: 0.3 * p, from: 5400, to: 1600, q: 1.2 })
    noise({ at: 0.06, duration: 0.08, volume: 0.18 * p, from: 4200, to: 2200, q: 1.6 })
    noise({ at: 0.08, duration: 1.0, volume: 0.09 * p, from: 2800, to: 500, q: 0.6 })
    for (let i = 0; i < 8; i += 1) {
      tone(220 + Math.random() * 480, { type: 'triangle', at: 0.16 + i * 0.075 + Math.random() * 0.05, duration: 0.05, volume: 0.05 * p, slideTo: 130 })
    }
  },
  /** The ball bouncing on after it lands (`n` 1, 2, 3...): a thud and a tok, softer each time. */
  bounce(n = 1) {
    if (!ready('bounce', 120)) return
    const v = 0.16 / n
    tone(150, { duration: 0.16, volume: v, slideTo: 60 })
    tone(1250 - n * 90, { duration: 0.04, volume: v * 0.7, slideTo: 900 })
  },
  /** A cartoon falling whistle over `duration` seconds, as the ball drops from the top of its arc. */
  fallWhistle(duration = 1.5) {
    if (!ready('fallWhistle', 300) || duration < 0.3) return
    tone(1800, { duration, volume: 0.045, slideTo: 420, attack: Math.min(0.3, duration * 0.2) })
  },
  /**
   * A PERFECT hit: a crack of the paddle, fire bursting up with a deep fwoosh and a
   * crackle, and a bright chime climbing up.
   */
  perfectHit() {
    if (!ready('perfectHit', 300)) return
    tone(2200, { duration: 0.04, volume: 0.2, slideTo: 1400 })
    noise({ duration: 0.45, volume: 0.22, from: 600, to: 5200, q: 0.9 })
    noise({ duration: 0.8, volume: 0.26, from: 180, to: 900, q: 0.6 })
    tone(90, { duration: 0.5, volume: 0.14, slideTo: 160 })
    for (let i = 0; i < 6; i += 1) noise({ at: 0.1 + i * 0.07 + Math.random() * 0.04, duration: 0.04, volume: 0.07, from: 3800, to: 2600, q: 2 })
    ;[784, 1047, 1319, 1568, 2093].forEach((f, i) => bell(f, { at: 0.04 + i * 0.05, volume: 0.07, decay: 0.35 }))
  },
  /**
   * A good hit's ball blasting away as time snaps back (`power` 0-1, the grade's): a deep
   * boom and a rising whoosh.
   */
  perfectRelease(power = 1) {
    if (!ready('perfectRelease', 300)) return
    tone(70, { duration: 0.6, volume: 0.3 * power, slideTo: 32 })
    noise({ duration: 0.5, volume: 0.28 * power, from: 300, to: 6000, q: 0.7 })
    tone(440, { type: 'triangle', duration: 0.35, volume: 0.06 * power, slideTo: 1760 })
  },
  /** The paddle smashing the ball on a graded hit: its own sound for each grade. */
  gradeHit(grade) {
    if (grade === 'perfect') return sfx.perfectHit()
    if (!ready('gradeHit', 300)) return
    if (grade === 'great') {
      // An electric crack, a zap and a rising chime.
      tone(1800, { type: 'square', duration: 0.05, volume: 0.1, slideTo: 600 })
      noise({ duration: 0.35, volume: 0.2, from: 2400, to: 7000, q: 1.4 })
      ;[659, 988, 1319].forEach((f, i) => bell(f, { at: 0.03 + i * 0.05, volume: 0.07, decay: 0.3 }))
    } else {
      // A clean, bright tok and a sparkle.
      tone(1500, { duration: 0.05, volume: 0.18, slideTo: 1050 })
      bell(1568, { at: 0.03, volume: 0.06, decay: 0.25 })
      bell(2093, { at: 0.08, volume: 0.05, decay: 0.25 })
    }
  },
  /** A WEAK hit: a dull, soft plop off the edge of the paddle. */
  weakHit() {
    if (!ready('weakHit', 300)) return
    tone(320, { duration: 0.12, volume: 0.12, slideTo: 140 })
    tone(180, { type: 'triangle', at: 0.08, duration: 0.18, volume: 0.06, slideTo: 90 })
  },
  /** A ping pong ball off a paddle at a training table: a short, hollow tok. */
  pong(soft = false) {
    if (!ready('pong', 120)) return
    const v = soft ? 0.05 : 0.1
    tone(1350 + Math.random() * 150, { duration: 0.035, volume: v, slideTo: 1000 })
    tone(2900, { type: 'triangle', duration: 0.018, volume: v * 0.3 })
  },
  /** The tire popping out in front of you when you press ROLL: a springy bloop. */
  tirePop() {
    if (!ready('tirePop', 200)) return
    tone(420, { type: 'sine', duration: 0.16, volume: 0.14, slideTo: 980 })
    tone(1320, { type: 'triangle', at: 0.08, duration: 0.1, volume: 0.06 })
  },
  /** Flying off a ramp: a rising rush of air. */
  jumpWhoosh() {
    if (ready('jumpWhoosh', 250)) noise({ duration: 0.4, volume: 0.18, from: 500, to: 2600, q: 0.9 })
  },
  /** The tire slapping back down after a jump: a thump and a crunch of gravel. */
  tireLand() {
    if (!ready('tireLand', 250)) return
    tone(160, { type: 'sine', duration: 0.2, volume: 0.18, slideTo: 55 })
    noise({ duration: 0.24, volume: 0.13, from: 2400, to: 300, q: 0.6 })
  },
  /**
   * The tire smashing through a wooden wall: a crunch of splintering noise over a low
   * thump, then a few high clattering clicks of falling planks (~0.4 s).
   */
  wallSmash(combo = 1) {
    if (!ready('wallSmash', 120)) return
    // The hit: a deep boom and a sharp wooden crack.
    tone(95, { duration: 0.26, volume: 0.24, slideTo: 40 })
    noise({ duration: 0.08, volume: 0.4, from: 5200, to: 1800, q: 0.6 })
    noise({ duration: 0.22, volume: 0.32, from: 3200, to: 700, q: 0.7 })
    noise({ duration: 0.4, volume: 0.12, from: 900, to: 260, q: 1.1 })
    // The pieces raining down: a clatter of little wooden clicks.
    for (let i = 0; i < 9; i += 1) {
      tone(1200 + Math.random() * 2200, { type: 'square', at: 0.08 + i * 0.045 + Math.random() * 0.03, duration: 0.025, volume: 0.035 })
    }
    // A bright 'ding' that climbs with every wall smashed in a row: the combo.
    const step = Math.min(combo - 1, 10)
    const f = 523 * Math.pow(2, (step * 2) / 12)
    tone(f, { type: 'triangle', at: 0.04, duration: 0.18, volume: 0.09, echo: true })
    tone(f * 1.5, { type: 'triangle', at: 0.1, duration: 0.22, volume: 0.06, echo: true })
  },
  /** A new stage reached mid-roll: a quick, cheerful rising jingle. */
  stageUp() {
    if (!ready('stageUp', 300)) return
    ;[659, 784, 988, 1319].forEach((f, i) => tone(f, { type: 'triangle', at: i * 0.06, duration: 0.16, volume: 0.08, echo: true }))
    for (let i = 0; i < 3; i += 1) bell(1760 + Math.random() * 900, { at: 0.24 + i * 0.05, volume: 0.03, decay: 0.18 })
  },
  /** Trophies landing in the Wins counter: little coin pings, one after another. */
  coins(count = 8) {
    if (!ready('coins', 400)) return
    for (let i = 0; i < count; i += 1) bell(1900 + (i % 4) * 230, { at: 0.55 + i * 0.07, volume: 0.04, decay: 0.12 })
  },
  /** The tire hitting a wall it can't break: a dull, heavy thud and a short low boing (~0.35 s). */
  wallBlock() {
    if (!ready('wallBlock', 150)) return
    tone(70, { duration: 0.28, volume: 0.24, slideTo: 38 })
    noise({ duration: 0.12, volume: 0.14, from: 500, to: 150, q: 0.9 })
    tone(150, { type: 'triangle', at: 0.05, duration: 0.3, volume: 0.07, slideTo: 95 })
  },
  /**
   * A trophy rolled through: a bell that climbs the scale and back down while they keep
   * coming, so a run of them plays a little tune.
   */
  trophy() {
    if (!ready('trophy', 90)) return
    const now = performance.now()
    trophyRun = now - trophyAt < TROPHY_RUN_MS ? trophyRun + 1 : 0
    trophyAt = now
    const n = TROPHY_SCALE.length
    const k = trophyRun % (2 * n - 2)
    bell(TROPHY_SCALE[k < n ? k : 2 * n - 2 - k], { volume: 0.085, decay: 0.32 })
  },
  /** Wins paid out (a roll's total, a badge): a fanfare, a shimmering chord and a shower of coins. */
  wins() {
    if (!ready('wins')) return
    ;[784, 988, 1175, 1568].forEach((f, i) => tone(f, { type: 'triangle', at: i * 0.07, duration: 0.2, volume: 0.1, echo: true }))
    // G major, held, each voice doubled a hair apart so it shimmers.
    for (const f of [784, 988, 1175]) {
      tone(f * 1.003, { at: 0.28, duration: 0.9, volume: 0.045, attack: 0.05, echo: true })
      tone(f * 0.997, { at: 0.28, duration: 0.9, volume: 0.045, attack: 0.05 })
    }
    for (let i = 0; i < 6; i += 1) bell(2093 + Math.random() * 1200, { at: 0.3 + i * 0.07 + Math.random() * 0.03, volume: 0.035, decay: 0.2 })
  },
  crack() {
    if (!ready('crack', 150)) return
    noise({ duration: 0.12, volume: 0.35, from: 1800, to: 600, q: 0.8 })
    tone(220, { type: 'square', duration: 0.08, volume: 0.08, slideTo: 90 })
  },
  reveal() {
    if (!ready('reveal')) return
    ;[392, 523, 659, 784, 1047].forEach((f, i) => tone(f, { type: 'triangle', at: i * 0.06, duration: 0.22, volume: 0.12 }))
  },
  buy() {
    if (!ready('buy')) return
    tone(1047, { type: 'square', duration: 0.07, volume: 0.08 })
    tone(1568, { type: 'square', at: 0.08, duration: 0.16, volume: 0.08 })
  },
  error() {
    if (ready('error', 200)) tone(160, { type: 'sawtooth', duration: 0.18, volume: 0.07, slideTo: 110 })
  },
  rebirth() {
    if (!ready('rebirth')) return
    noise({ duration: 0.8, volume: 0.15, from: 200, to: 4000, q: 0.6 })
    ;[262, 330, 392, 523, 659, 784].forEach((f, i) => tone(f, { type: 'sawtooth', at: 0.1 + i * 0.07, duration: 0.25, volume: 0.06 }))
  },
  /** Stepping onto an unlocked training pad: a soft rising chime. */
  treadmillEnter() {
    if (!ready('treadmillEnter', 400)) return
    ;[523, 784, 1047].forEach((f, i) => tone(f, { type: 'sine', at: i * 0.05, duration: 0.28, volume: 0.07 }))
  },
  /** A jump: a springy little boing. */
  jump() {
    if (ready('jump', 120)) tone(260, { type: 'triangle', duration: 0.18, volume: 0.1, slideTo: 620 })
  },
  /** Landing from a jump: a soft thump. */
  jumpLand() {
    if (!ready('jumpLand', 150)) return
    tone(140, { type: 'sine', duration: 0.12, volume: 0.12, slideTo: 70 })
    noise({ duration: 0.08, volume: 0.06, from: 900, to: 300, q: 0.7 })
  },
  /**
   * The tire skidding to a stop, timed to end as it does: grit spraying off the tread
   * (bright, then darker as it slows), the rubber grinding under it, then a bump and a
   * little bounce as it settles.
   */
  rollStop() {
    if (!ready('rollStop')) return
    noise({ duration: 0.85, volume: 0.2, from: 5200, to: 700, q: 0.5 })
    noise({ duration: 0.8, volume: 0.12, from: 380, to: 120, q: 0.9 })
    tone(130, { at: 0.82, duration: 0.22, volume: 0.16, slideTo: 60 })
    tone(220, { type: 'triangle', at: 0.96, duration: 0.1, volume: 0.05, slideTo: 330 })
  },
  windStart,
  windSet,
  windStop,
}

// The template's names, kept as aliases while callers move over to the tire ones.
sfx.slideStart = sfx.rollStart
sfx.slideStop = sfx.rollStop
sfx.boardPop = sfx.tirePop
sfx.boardLand = sfx.tireLand
