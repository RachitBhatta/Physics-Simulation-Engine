import { useEffect, useRef, useState } from 'react'
import Dial from '../../components/Dial'
import Switch from '../../components/Switch'
import Checkbox from '../../components/Checkbox'
import RadioGroup from '../../components/RadioGroup'
import type { Theme } from '../../lib/useTheme'
import {
  drawDraggableRuler,
  drawDraggableStopwatch,
  hitTestRuler,
  hitTestStopwatch,
  hitTestStopwatchReset,
  type ToolPos,
} from '../../lib/canvasTools'
import './PendulumSim.css'

interface Props {
  theme: Theme
  onBack: () => void
}

interface Colors {
  axis: string
  guide: string
  rod: string
  bob: string
  velocity: string
  accel: string
  trail: string
  text: string
  panel: string
  violet: string
  brass: string
}

type GraphType = 'angle' | 'xy' | 'energy'
type Speed = 'normal' | 'slow'

const PIXELS_PER_METER = 220
const SUBSTEPS = 8
const MAX_ANGLE = 2.7 // ~155 degrees, matches a real pendulum's practical swing limit

export default function PendulumSim({ theme, onBack }: Props) {
  const mainRef = useRef<HTMLCanvasElement>(null)
  const waveRef = useRef<HTMLCanvasElement>(null)
  const colorsRef = useRef<Colors | null>(null)
  const rafRef = useRef<number>(0)

  const thetaRef = useRef(0.6) // radians from straight down
  const omegaRef = useRef(0)
  const draggingRef = useRef(false)
  const timeRef = useRef(0)
  const historyRef = useRef<{ t: number; theta: number; x: number; y: number; ke: number; pe: number }[]>([])
  const trailRef = useRef<{ x: number; y: number }[]>([])
  const lastCrossingRef = useRef<number | null>(null)
  const measuredPeriodRef = useRef<number | null>(null)
  const lastSignRef = useRef(1)
  const stepRequestRef = useRef(false)

  const rulerPosRef = useRef<ToolPos>({ x: 16, y: 16 })
  const stopwatchPosRef = useRef<ToolPos>({ x: 130, y: 16 })
  const draggedToolRef = useRef<'ruler' | 'stopwatch' | null>(null)
  const toolDragOffsetRef = useRef({ dx: 0, dy: 0 })
  const stopwatchOffsetRef = useRef(0)

  const [length, setLength] = useState(0.7) // meters
  const [mass, setMass] = useState(1) // kg (affects friction's relative effect)
  const [gravity, setGravity] = useState(9.8) // m/s^2
  const [friction, setFriction] = useState(0)
  const [running, setRunning] = useState(true)
  const [showVelocity, setShowVelocity] = useState(true)
  const [showAccel, setShowAccel] = useState(true)
  const [showRuler, setShowRuler] = useState(false)
  const [showStopwatch, setShowStopwatch] = useState(false)
  const [showTrace, setShowTrace] = useState(false)
  const [graphType, setGraphType] = useState<GraphType>('angle')
  const [speed, setSpeed] = useState<Speed>('normal')

  const lengthRef = useRef(length)
  const massRef = useRef(mass)
  const gravityRef = useRef(gravity)
  const frictionRef = useRef(friction)
  const runningRef = useRef(running)
  const showTraceRef = useRef(showTrace)
  const graphTypeRef = useRef(graphType)
  const speedRef = useRef(speed)

  useEffect(() => {
    graphTypeRef.current = graphType
  }, [graphType])
  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  useEffect(() => {
    lengthRef.current = length
  }, [length])
  useEffect(() => {
    massRef.current = mass
  }, [mass])
  useEffect(() => {
    gravityRef.current = gravity
  }, [gravity])
  useEffect(() => {
    frictionRef.current = friction
  }, [friction])
  useEffect(() => {
    runningRef.current = running
  }, [running])
  useEffect(() => {
    showTraceRef.current = showTrace
    if (!showTrace) trailRef.current = []
  }, [showTrace])

  useEffect(() => {
    const s = getComputedStyle(document.documentElement)
    const get = (name: string) => s.getPropertyValue(name).trim()
    colorsRef.current = {
      axis: get('--panel-border'),
      guide: get('--text-muted'),
      rod: get('--text'),
      bob: get('--brass-bright'),
      velocity: get('--teal'),
      accel: get('--rust'),
      trail: get('--brass'),
      text: get('--text-muted'),
      panel: get('--panel'),
      violet: get('--violet'),
      brass: get('--brass'),
    }
  }, [theme])

  const reset = () => {
    thetaRef.current = 0.6
    omegaRef.current = 0
    timeRef.current = 0
    historyRef.current = []
    trailRef.current = []
    lastCrossingRef.current = null
    measuredPeriodRef.current = null
  }

  useEffect(() => {
    const mainCanvas = mainRef.current
    const waveCanvas = waveRef.current
    if (!mainCanvas || !waveCanvas) return

    const dpr = window.devicePixelRatio || 1
    const setupCanvas = (c: HTMLCanvasElement) => {
      const rect = c.getBoundingClientRect()
      c.width = rect.width * dpr
      c.height = rect.height * dpr
      const ctx = c.getContext('2d')!
      ctx.scale(dpr, dpr)
      return { ctx, w: rect.width, h: rect.height }
    }

    let main = setupCanvas(mainCanvas)
    let wave = setupCanvas(waveCanvas)

    const handleResize = () => {
      main = setupCanvas(mainCanvas)
      wave = setupCanvas(waveCanvas)
    }
    window.addEventListener('resize', handleResize)

    const pivotX = () => main.w / 2
    const pivotY = () => 36

    const physicsStep = (dt: number) => {
      const g = gravityRef.current
      const L = lengthRef.current
      const b = frictionRef.current
      const subDt = dt / SUBSTEPS
      for (let s = 0; s < SUBSTEPS; s++) {
        // theta'' = -(g/L) sin(theta) - (b/m) theta'
        // Semi-implicit (symplectic) Euler: update omega first, then use
        // the NEW omega to update theta. Far more stable over long runs
        // than naive forward Euler, without needing full RK4.
        const alpha = -(g / L) * Math.sin(thetaRef.current) - (b / massRef.current) * omegaRef.current
        omegaRef.current += alpha * subDt
        thetaRef.current += omegaRef.current * subDt
      }
      thetaRef.current = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, thetaRef.current))

      // Period measurement: a full period is the time between two
      // consecutive crossings of the equilibrium point in the SAME
      // direction, i.e. every other zero-crossing.
      const sign = Math.sign(thetaRef.current) || lastSignRef.current
      if (sign !== lastSignRef.current) {
        const t = timeRef.current
        if (lastCrossingRef.current != null) {
          const half = t - lastCrossingRef.current
          measuredPeriodRef.current = half * 2
        }
        lastCrossingRef.current = t
        lastSignRef.current = sign
      }

      timeRef.current += dt
    }

    const drawProtractor = (ctx: CanvasRenderingContext2D, colors: Colors) => {
      const px = pivotX()
      const py = pivotY()
      const R = 100
      ctx.save()
      ctx.translate(px, py)
      ctx.strokeStyle = colors.guide
      ctx.globalAlpha = 0.6
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(0, 0, R, -MAX_ANGLE + Math.PI / 2, MAX_ANGLE + Math.PI / 2)
      ctx.stroke()
      for (let deg = -150; deg <= 150; deg += 15) {
        const a = (deg * Math.PI) / 180 + Math.PI / 2
        const long = deg % 30 === 0
        const r0 = R - (long ? 10 : 6)
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
        ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      // dashed vertical reference (equilibrium)
      ctx.strokeStyle = colors.guide
      ctx.setLineDash([4, 5])
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(0, R + 260)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      ctx.restore()
    }

    const drawArrow = (
      ctx: CanvasRenderingContext2D,
      x0: number,
      y0: number,
      dx: number,
      dy: number,
      color: string,
    ) => {
      const len = Math.hypot(dx, dy)
      if (len < 2) return
      const x1 = x0 + dx
      const y1 = y0 + dy
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      const angle = Math.atan2(dy, dx)
      const headLen = 9
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x1 - headLen * Math.cos(angle - Math.PI / 6), y1 - headLen * Math.sin(angle - Math.PI / 6))
      ctx.lineTo(x1 - headLen * Math.cos(angle + Math.PI / 6), y1 - headLen * Math.sin(angle + Math.PI / 6))
      ctx.closePath()
      ctx.fill()
    }

    const drawMain = () => {
      const colors = colorsRef.current
      if (!colors) return
      const { ctx, w, h } = main
      ctx.clearRect(0, 0, w, h)

      drawProtractor(ctx, colors)

      const px = pivotX()
      const py = pivotY()
      const L = lengthRef.current * PIXELS_PER_METER
      const theta = thetaRef.current
      const omega = omegaRef.current
      const g = gravityRef.current
      const b = frictionRef.current
      const alpha = -(g / lengthRef.current) * Math.sin(theta) - (b / massRef.current) * omega

      const bobX = px + L * Math.sin(theta)
      const bobY = py + L * Math.cos(theta)

      if (showTraceRef.current && runningRef.current) {
        trailRef.current.push({ x: bobX, y: bobY })
        if (trailRef.current.length > 90) trailRef.current.shift()
      }
      if (showTraceRef.current) {
        const trail = trailRef.current
        for (let i = 0; i < trail.length; i++) {
          const a = i / trail.length
          ctx.beginPath()
          ctx.arc(trail[i].x, trail[i].y, 2, 0, Math.PI * 2)
          ctx.fillStyle = colors.trail
          ctx.globalAlpha = a * 0.5
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }

      // rod
      ctx.strokeStyle = colors.rod
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(bobX, bobY)
      ctx.stroke()

      // pivot
      ctx.beginPath()
      ctx.arc(px, py, 4, 0, Math.PI * 2)
      ctx.fillStyle = colors.rod
      ctx.fill()

      // bob mass, sized by the mass dial
      const bobR = 12 + massRef.current * 6
      ctx.beginPath()
      ctx.arc(bobX, bobY, bobR, 0, Math.PI * 2)
      ctx.fillStyle = colors.bob
      ctx.fill()
      ctx.strokeStyle = colors.axis
      ctx.lineWidth = 1.5
      ctx.stroke()

      // velocity vector (tangential): v = L*omega, direction perpendicular to rod
      if (showVelocity) {
        const vScale = 18
        const vx = L * omega * Math.cos(theta) * vScale * 0.01
        const vy = -L * omega * Math.sin(theta) * vScale * 0.01
        drawArrow(ctx, bobX, bobY, vx, vy, colors.velocity)
      }

      // acceleration vector (tangential + centripetal combined)
      if (showAccel) {
        const aScale = 3.2
        const ax = L * (-Math.sin(theta) * omega * omega + Math.cos(theta) * alpha) * aScale * 0.01
        const ay = L * (-Math.cos(theta) * omega * omega - Math.sin(theta) * alpha) * aScale * 0.01
        drawArrow(ctx, bobX, bobY, ax, ay, colors.accel)
      }

      // angle readout
      ctx.font = '13px var(--font-mono, monospace)'
      ctx.fillStyle = colors.text
      ctx.fillText(`θ = ${((theta * 180) / Math.PI).toFixed(1)}°`, 14, h - 14)

      if (showRuler) {
        drawDraggableRuler(ctx, rulerPosRef.current, colors)
      }

      if (showStopwatch) {
        drawDraggableStopwatch(ctx, stopwatchPosRef.current, timeRef.current - stopwatchOffsetRef.current, colors)
      }

      if (showTrace) {
        const p = measuredPeriodRef.current
        ctx.font = '13px var(--font-mono, monospace)'
        ctx.fillStyle = colors.text
        ctx.fillText(p ? `T ≈ ${p.toFixed(2)} s` : 'T ≈ measuring…', w - 130, h - 14)
      }
    }

    const drawWave = () => {
      const colors = colorsRef.current
      if (!colors) return
      const { ctx, w, h } = wave
      ctx.clearRect(0, 0, w, h)
      const midY = h / 2

      ctx.strokeStyle = colors.axis
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.moveTo(0, midY)
      ctx.lineTo(w, midY)
      ctx.stroke()
      ctx.globalAlpha = 1

      const hist = historyRef.current
      if (hist.length < 2) return
      const tNow = hist[hist.length - 1].t
      const WINDOW = 6
      const tMin = tNow - WINDOW

      const plotSeries = (
        pick: (p: (typeof hist)[number]) => number,
        color: string,
        scale: number,
        baseline: number,
      ) => {
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.beginPath()
        let started = false
        for (const p of hist) {
          if (p.t < tMin) continue
          const px = ((p.t - tMin) / WINDOW) * w
          const py = baseline - pick(p) * scale
          if (!started) {
            ctx.moveTo(px, py)
            started = true
          } else {
            ctx.lineTo(px, py)
          }
        }
        ctx.stroke()
      }

      const graphType = graphTypeRef.current
      if (graphType === 'angle') {
        plotSeries((p) => p.theta, colors.velocity, (h / 2 - 8) / MAX_ANGLE, midY)
      } else if (graphType === 'xy') {
        const L = lengthRef.current * PIXELS_PER_METER
        plotSeries((p) => p.x, colors.velocity, (h / 2 - 8) / L, midY)
        plotSeries((p) => p.y, colors.violet, (h / 2 - 8) / L, midY)
      } else {
        // energy: plot on a shared 0-to-max baseline instead of centered,
        // since KE and PE are never negative
        const maxE = Math.max(1e-6, ...hist.filter((p) => p.t >= tMin).map((p) => Math.max(p.ke, p.pe)))
        const scale = (h - 16) / maxE
        plotSeries((p) => p.ke, colors.velocity, scale, h - 8)
        plotSeries((p) => p.pe, colors.violet, scale, h - 8)
      }
    }

    let lastTs: number | null = null
    const advance = (dt: number) => {
      physicsStep(dt)
      const L = lengthRef.current
      const theta = thetaRef.current
      const omega = omegaRef.current
      const v = L * omega
      const x = L * Math.sin(theta)
      const y = L * (1 - Math.cos(theta)) // height above lowest point
      const ke = 0.5 * massRef.current * v * v
      const pe = massRef.current * gravityRef.current * y
      historyRef.current.push({ t: timeRef.current, theta, x, y, ke, pe })
      const cutoff = timeRef.current - 7
      while (historyRef.current.length && historyRef.current[0].t < cutoff) {
        historyRef.current.shift()
      }
    }
    const animate = (ts: number) => {
      if (lastTs == null) lastTs = ts
      const rawDt = Math.min((ts - lastTs) / 1000, 0.033)
      const dt = speedRef.current === 'slow' ? rawDt * 0.3 : rawDt
      lastTs = ts

      if (runningRef.current && !draggingRef.current) {
        advance(dt)
      } else if (!draggingRef.current && stepRequestRef.current) {
        stepRequestRef.current = false
        advance(0.1)
      }

      drawMain()
      drawWave()
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)

    const updateFromPointer = (clientX: number, clientY: number) => {
      const rect = mainCanvas.getBoundingClientRect()
      const px = clientX - rect.left - pivotX()
      const py = clientY - rect.top - pivotY()
      let theta = Math.atan2(px, py)
      theta = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, theta))
      thetaRef.current = theta
      omegaRef.current = 0
    }
    const onPointerDown = (e: PointerEvent) => {
      const rect = mainCanvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top

      if (showStopwatch && hitTestStopwatchReset(stopwatchPosRef.current, px, py)) {
        stopwatchOffsetRef.current = timeRef.current
        return
      }
      if (showStopwatch && hitTestStopwatch(stopwatchPosRef.current, px, py)) {
        draggedToolRef.current = 'stopwatch'
        toolDragOffsetRef.current = { dx: px - stopwatchPosRef.current.x, dy: py - stopwatchPosRef.current.y }
        return
      }
      if (showRuler && hitTestRuler(rulerPosRef.current, px, py)) {
        draggedToolRef.current = 'ruler'
        toolDragOffsetRef.current = { dx: px - rulerPosRef.current.x, dy: py - rulerPosRef.current.y }
        return
      }

      draggingRef.current = true
      updateFromPointer(e.clientX, e.clientY)
    }
    const onPointerMove = (e: PointerEvent) => {
      const rect = mainCanvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top

      if (draggedToolRef.current === 'stopwatch') {
        stopwatchPosRef.current = { x: px - toolDragOffsetRef.current.dx, y: py - toolDragOffsetRef.current.dy }
        return
      }
      if (draggedToolRef.current === 'ruler') {
        rulerPosRef.current = { x: px - toolDragOffsetRef.current.dx, y: py - toolDragOffsetRef.current.dy }
        return
      }
      if (!draggingRef.current) return
      updateFromPointer(e.clientX, e.clientY)
    }
    const onPointerUp = () => {
      draggingRef.current = false
      draggedToolRef.current = null
    }
    mainCanvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', handleResize)
      mainCanvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRuler, showStopwatch, showTrace, showVelocity, showAccel])

  return (
    <div className="sim">
      <div className="sim__header">
        <button className="sim__back" onClick={onBack}>
          ← Cabinet
        </button>
        <div className="sim__plate-label">
          <span className="mono">SPECIMEN NO. 05</span>
          <h2>Simple Pendulum</h2>
        </div>
      </div>

      <div className="sim__body">
        <div className="sim__viewport">
          <div className="sim__panel sim__panel--pendulum">
            <canvas ref={mainRef} className="sim__canvas sim__canvas--drag" />
          </div>
          <div className="sim__panel sim__panel--wave">
            <div className="sim__wave-legend">
              {graphType === 'angle' && (
                <span className="mono" style={{ color: 'var(--teal)' }}>
                  θ(t) — angular displacement
                </span>
              )}
              {graphType === 'xy' && (
                <>
                  <span className="mono" style={{ color: 'var(--teal)' }}>
                    x(t)
                  </span>
                  <span className="mono" style={{ color: 'var(--violet)' }}>
                    y(t) — height above lowest point
                  </span>
                </>
              )}
              {graphType === 'energy' && (
                <>
                  <span className="mono" style={{ color: 'var(--teal)' }}>
                    KE(t)
                  </span>
                  <span className="mono" style={{ color: 'var(--violet)' }}>
                    PE(t)
                  </span>
                </>
              )}
            </div>
            <canvas ref={waveRef} className="sim__canvas sim__canvas--wave" />
          </div>
        </div>

        <div className="sim__controls">
          <div className="sim__control-group">
            <Dial label="Length" value={length} min={0.2} max={1.5} step={0.05} unit="m" onChange={setLength} />
            <Dial label="Mass" value={mass} min={0.2} max={2} step={0.1} unit="kg" onChange={setMass} />
            <Dial label="Gravity" value={gravity} min={0} max={20} step={0.1} unit="m/s²" onChange={setGravity} />
            <Dial label="Friction" value={friction} min={0} max={0.5} step={0.01} onChange={setFriction} />
          </div>

          <div className="sim__control-group">
            <Switch label="Velocity vector" checked={showVelocity} onChange={setShowVelocity} swatch="var(--teal)" />
            <Switch label="Acceleration vector" checked={showAccel} onChange={setShowAccel} swatch="var(--rust)" />
          </div>

          <div className="sim__control-group">
            <RadioGroup<GraphType>
              legend="Graph"
              options={[
                { value: 'angle', label: 'Angle θ(t)' },
                { value: 'xy', label: 'X-Y displacement' },
                { value: 'energy', label: 'Kinetic / Potential' },
              ]}
              value={graphType}
              onChange={setGraphType}
            />
          </div>

          <div className="sim__control-group">
            <RadioGroup<Speed>
              legend="Speed"
              options={[
                { value: 'normal', label: 'Normal' },
                { value: 'slow', label: 'Slow' },
              ]}
              value={speed}
              onChange={setSpeed}
            />
          </div>

          <div className="sim__control-group">
            <Checkbox label="Ruler" checked={showRuler} onChange={setShowRuler} />
            <Checkbox label="Stopwatch" checked={showStopwatch} onChange={setShowStopwatch} />
            <Checkbox label="Period trace" checked={showTrace} onChange={setShowTrace} />
          </div>

          <div className="sim__buttons">
            <button className="sim__btn sim__btn--primary" onClick={() => setRunning((r) => !r)}>
              {running ? 'Pause' : 'Play'}
            </button>
            <button
              className="sim__btn"
              onClick={() => {
                stepRequestRef.current = true
              }}
              disabled={running}
            >
              Step +0.1s
            </button>
          </div>
          <div className="sim__buttons">
            <button className="sim__btn" onClick={reset}>
              Reset
            </button>
          </div>

          <p className="sim__note">
            Drag the bob to set a starting angle, then let go. Watch how
            the <span style={{ color: 'var(--teal)' }}>velocity vector</span>{' '}
            is longest at the bottom of the swing and vanishes at the
            extremes, while the{' '}
            <span style={{ color: 'var(--rust)' }}>acceleration vector</span>{' '}
            does the opposite — largest at the extremes (restoring force)
            and, at the bottom, points straight up toward the pivot
            (pure centripetal). For small angles this reduces to SHM with{' '}
            <code className="mono">T = 2π√(L/g)</code>; swing it past
            ~20° and watch the period trace drift from that prediction.
          </p>
        </div>
      </div>
    </div>
  )
}
