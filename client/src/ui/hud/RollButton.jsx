import { useCallback, useEffect, useRef, useState } from 'react'

import { HIT_GRADES, hitGrade, METER_PERIOD, TUTORIAL } from '@shared/balance'

import { sfx } from '../../audio/sfx'
import { actions } from '../../net/actions'
import { useGame } from '../../store/game'
import Icon from '../Icon'
import StrokeText from '../StrokeText'
import { ChunkyButton } from './parts'
import { GRADIENTS, u } from './style'

/**
 * A press is ignored this soon after the last (a double tap, a bouncing key). Short: the
 * needle first crosses the middle METER_PERIOD / 4 after the meter starts.
 */
const PRESS_COOLDOWN_MS = 150
/** With Auto Serve on, the next serve goes this long after you're back on the zone. */
const AUTO_DELAY_MS = 700

/**
 * Where the needle is (0-1 across the bar) `ms` after the meter started from `start` (a
 * phase, 0-1, picked at random each serve): a pendulum, lingering at the ends and
 * fastest through the middle, so the PERFECT moment is a short one.
 */
const needleAt = (ms, start) => 0.5 - 0.5 * Math.cos((ms / 1000 / METER_PERIOD + start) * Math.PI * 2)
/** 1 dead centre, 0 at either end: what the server grades. */
const accuracyAt = (pos) => 1 - Math.abs(pos * 2 - 1)

/** The bar's bands, from the grades: [from, to] as fractions of its width, centre out. */
/** The bar's coloured bands, from the grades: each runs `half` of the bar either side of its centre. */
const BANDS = HIT_GRADES.filter((g) => g.min > 0).map((g) => ({ id: g.id, half: (1 - g.min) / 2 }))
const BAND_COLORS = {
  perfect: 'linear-gradient(180deg, #fff6a3 0%, #ffd21f 55%, #ff9c00 100%)',
  great: 'linear-gradient(180deg, #d9ff9a 0%, #5fe83a 55%, #1fb52a 100%)',
  good: 'linear-gradient(180deg, #fff3b0 0%, #ffe23a 55%, #f0b400 100%)',
}
/** Each grade's colour for the live label over the meter. */
const GRADE_COLORS = { perfect: '#ffd21f', great: '#7dff4a', good: '#fff3a0', weak: '#ff6a5a' }

/**
 * The big green SERVE! button, shown while standing on the SERVE ZONE. Press it (or E /
 * Enter) and a timing meter swings under your ball: press again to hit. The nearer the
 * middle you stop it, the more the serve pays (HIT_GRADES). With the Auto Serve pass, a
 * toggle under it serves for you every time you're back, without the meter.
 *
 * The needle is moved straight on the DOM every animation frame; React only hears about
 * the meter starting and stopping.
 */
export function RollButton() {
  const visible = useGame((s) => s.zone.rollZone && !s.roll && !s.rollResult && !s.panel)
  const ownsAuto = useGame((s) => Boolean(s.profile.passes.autoRoll))
  const autoOn = useGame((s) => Boolean(s.profile.passes.autoRoll && s.profile.settings.autoRoll))
  // The bouncing arrow over it is for the tutorial's serve step only.
  const pointAt = useGame((s) => TUTORIAL[s.profile.tutorialStep]?.event === 'roll')
  const lastPress = useRef(-Infinity)
  /** performance.now() the meter started swinging, or 0 while it's put away. */
  const [aimingSince, setAimingSince] = useState(0)
  /** Where in its swing the needle starts this serve (0-1): random, so no rhythm works every time. */
  const [aimStart, setAimStart] = useState(0)
  const needleRef = useRef(null)
  const percentRef = useRef(null)

  const press = useCallback(() => {
    const now = performance.now()
    if (now - lastPress.current < PRESS_COOLDOWN_MS) return
    lastPress.current = now
    if (!aimingSince) {
      // First press: the meter starts swinging.
      sfx.click()
      setAimStart(Math.random())
      setAimingSince(now)
      return
    }
    // Second press: hit it where the needle is.
    const accuracy = accuracyAt(needleAt(now - aimingSince, aimStart))
    setAimingSince(0)
    actions.roll(Math.round(accuracy * 1000) / 1000)
  }, [aimingSince, aimStart])

  const autoServe = useCallback(() => {
    setAimingSince(0)
    actions.roll()
  }, [])

  // Off the zone (or into a serve) the meter is put away.
  const [wasVisible, setWasVisible] = useState(visible)
  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (!visible) setAimingSince(0)
  }

  useEffect(() => {
    if (!visible) return undefined
    const onKey = (e) => {
      if (e.repeat) return
      if (e.code === 'KeyE' || e.code === 'Enter') press()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, press])

  // Auto Serve: serve again as soon as you're back on the zone.
  useEffect(() => {
    if (!visible || !autoOn) return undefined
    const id = setTimeout(autoServe, AUTO_DELAY_MS)
    return () => clearTimeout(id)
  }, [visible, autoOn, autoServe])

  // The needle, every frame, while aiming.
  useEffect(() => {
    if (!aimingSince) return undefined
    let raf = 0
    const tick = () => {
      const pos = needleAt(performance.now() - aimingSince, aimStart)
      if (needleRef.current) needleRef.current.style.left = `${pos * 100}%`
      // The grade a hit right now would be, in its colour: both layers of the outlined
      // text (StrokeText), the outline and the fill.
      const accuracy = accuracyAt(pos)
      const grade = hitGrade(accuracy)
      const text = `${grade.label.replace(/[!.]+$/, '')} ${Math.round(accuracy * 100)}%`
      for (const layer of percentRef.current?.querySelectorAll('.pp-text-stroke, .pp-text-fill') ?? []) layer.textContent = text
      const fill = percentRef.current?.querySelector('.pp-text-fill')
      if (fill) fill.style.color = GRADE_COLORS[grade.id]
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [aimingSince, aimStart])

  if (!visible) return null
  const label = aimingSince ? 'HIT!' : 'Serve!'
  return (
    <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ bottom: u(300) }}>
      {pointAt && !aimingSince && <Icon name="arrowDown" size={u(80)} className="pp-bounce" style={{ marginBottom: u(8) }} />}
      {aimingSince > 0 && (
        <div className="flex flex-col items-center" style={{ marginBottom: u(18) }}>
          <span ref={percentRef} style={{ fontSize: u(64), color: '#ffd21f' }}>
            <StrokeText stroke={u(12)}>0%</StrokeText>
          </span>
          <div
            className="relative overflow-visible"
            style={{
              width: u(560),
              height: u(54),
              borderRadius: u(27),
              border: `${u(6)} solid #1b1b1f`,
              background: 'linear-gradient(90deg, #ff3b3b 0%, #ff7a2a 100%)',
              boxShadow: `0 ${u(6)} 0 rgba(0,0,0,0.35)`,
            }}
          >
            {BANDS.slice()
              .reverse()
              .map((b) => (
                <div
                  key={b.id}
                  className="absolute top-0 bottom-0"
                  style={{ left: `${(0.5 - b.half) * 100}%`, width: `${b.half * 200}%`, background: BAND_COLORS[b.id] }}
                />
              ))}
            <div
              ref={needleRef}
              className="absolute"
              style={{
                top: u(-14),
                bottom: u(-14),
                width: u(22),
                marginLeft: u(-11),
                left: '0%',
                borderRadius: u(8),
                background: '#ffffff',
                border: `${u(5)} solid #1b1b1f`,
              }}
            />
          </div>
          <span style={{ fontSize: u(30), marginTop: u(10) }}>
            <StrokeText stroke={u(7)}>Stop it in the middle: the harder you hit, the further it flies!</StrokeText>
          </span>
        </div>
      )}
      <ChunkyButton gradient={aimingSince ? GRADIENTS.goldButton : GRADIENTS.greenButton} onClick={press} title={label} radius={12} border={6} className="pp-roll-btn" style={{ width: u(360), height: u(104), gap: u(10) }}>
        <Icon name="tire" size={u(84)} />
        <span style={{ fontSize: u(76) }}>
          <StrokeText stroke={u(14)}>{label}</StrokeText>
        </span>
      </ChunkyButton>
      {ownsAuto && (
        <ChunkyButton
          gradient={autoOn ? GRADIENTS.goldButton : GRADIENTS.greyButton}
          onClick={() => actions.setSetting('autoRoll', !autoOn)}
          title="Auto Serve"
          radius={10}
          border={4}
          style={{ height: u(56), padding: `0 ${u(20)}`, marginTop: u(12) }}
        >
          <span style={{ fontSize: u(32) }}>
            <StrokeText stroke={u(7)}>Auto Serve: {autoOn ? 'ON' : 'OFF'}</StrokeText>
          </span>
        </ChunkyButton>
      )}
    </div>
  )
}

export default RollButton
