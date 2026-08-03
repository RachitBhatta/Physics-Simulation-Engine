import { useEffect, useRef, useState } from 'react'
import Dial from '../../components/Dial'
import RadioGroup from '../../components/RadioGroup'
import Checkbox from '../../components/Checkbox'
import type { Theme } from '../../lib/useTheme'
import {
  drawDraggableRuler,
  drawDraggableStopwatch,
  hitTestRuler,
  hitTestStopwatch,
  hitTestStopwatchReset,
  type ToolPos,
} from '../../lib/canvasTools'
import './StringWaveSim.css'

interface Props {
  theme: Theme
  onBack: () => void
}

interface Colors {
  axis: string
  guide: string
  string: string
  node: string
  drive: string
  text: string
  brass: string
  panel: string
}

type SourceMode = 'manual' | 'oscillate' | 'pulse'
type EndType = 'fixed' | 'loose' | 'none'
type Speed = 'normal' | 'slow'

const N = 220
const WINDOW_SECONDS = 6
const STEP_DT = 0.1 // fixed step size for the "Step" button

export default function StringWaveSim({ theme, onBack }: Props) {
  const stringRef = useRef<HTMLCanvasElement>(null)
  const waveRef = useRef<HTMLCanvasElement>(null)
  const colorsRef = useRef<Colors | null>(null)

  const yRef = useRef<Float32Array>(new Float32Array(N))
  const yPrevRef = useRef<Float32Array>(new Float32Array(N))
  const yNextRef = useRef<Float32Array>(new Float32Array(N))

  const timeRef = useRef(0)
  const historyRef = useRef<{ t: number; y: number }[]>([])
  const rafRef = useRef<number>(0)
  const draggingRef = useRef(false)
  const dragYRef = useRef(0)
  const smoothedDragYRef = useRef(0)
  const manualHoldRef = useRef(0)
  const stepRequestRef = useRef(false)

  const rulerPosRef = useRef<ToolPos>({ x: 20, y: 16 })
  const stopwatchPosRef = useRef<ToolPos>({ x: 140, y: 16 })
  const draggedToolRef = useRef<'ruler' | 'stopwatch' | null>(null)
  const toolDragOffsetRef = useRef({ dx: 0, dy: 0 })
  const stopwatchOffsetRef = useRef(0)

  const [mode, setMode] = useState<SourceMode>('oscillate')
  const [endType, setEndType] = useState<EndType>('fixed')
  const [speed, setSpeed] = useState<Speed>('normal')
  const [tension, setTension] = useState(0.5)
  const [damping, setDamping] = useState(0.999)
  const [driveFreq, setDriveFreq] = useState(0.6)
  const [driveAmp, setDriveAmp] = useState(50)
  const [running, setRunning] = useState(true)
  const [showReference, setShowReference] = useState(true)
  const [showRuler, setShowRuler] = useState(false)
  const [showStopwatch, setShowStopwatch] = useState(false)
  const [smoothStroke, setSmoothStroke] = useState(true)

  const modeRef = useRef(mode)
  const endTypeRef = useRef(endType)
  const speedRef = useRef(speed)
  const tensionRef = useRef(tension)
  const dampingRef = useRef(damping)
  const driveFreqRef = useRef(driveFreq)
  const driveAmpRef = useRef(driveAmp)
  const runningRef = useRef(running)
  const smoothStrokeRef = useRef(smoothStroke)

  useEffect(() => {
    modeRef.current = mode
  }, [mode])
  useEffect(() => {
    endTypeRef.current = endType
  }, [endType])
  useEffect(() => {
    speedRef.current = speed
  }, [speed])
  useEffect(() => {
    tensionRef.current = tension
  }, [tension])
  useEffect(() => {
    dampingRef.current = damping
  }, [damping])
  useEffect(() => {
    driveFreqRef.current = driveFreq
  }, [driveFreq])
  useEffect(() => {
    driveAmpRef.current = driveAmp
  }, [driveAmp])
  useEffect(() => {
    runningRef.current = running
  }, [running])
  useEffect(() => {
    smoothStrokeRef.current = smoothStroke
  }, [smoothStroke])

  useEffect(() => {
    const s = getComputedStyle(document.documentElement)
    const get = (name: string) => s.getPropertyValue(name).trim()
    colorsRef.current = {
      axis: get('--panel-border'),
      guide: get('--text-muted'),
      string: get('--text'),
      node: get('--rust'),
      drive: get('--brass-bright'),
      text: get('--text-muted'),
      brass: get('--brass'),
      panel: get('--panel'),
    }
  }, [theme])

  const reset = () => {
    yRef.current.fill(0)
    yPrevRef.current.fill(0)
    yNextRef.current.fill(0)
    timeRef.current = 0
    historyRef.current = []
    manualHoldRef.current = 0
    smoothedDragYRef.current = 0
    stopwatchOffsetRef.current = 0
  }

  const sendPulse = () => {
    const y = yRef.current
    const yPrev = yPrevRef.current
    const halfWidth = 22
    const amp = 90
    const shift = 6
    for (let i = 1; i <= halfWidth * 2 && i < N - 1; i++) {
      const frac = (i - halfWidth) / halfWidth
      const shape = 0.5 * (1 + Math.cos(Math.PI * Math.min(1, Math.abs(frac))))
      y[i] = amp * shape
      const frac2 = (i + shift - halfWidth) / halfWidth
      const shape2 = 0.5 * (1 + Math.cos(Math.PI * Math.min(1, Math.abs(frac2))))
      yPrev[i] = amp * shape2
    }
  }

  useEffect(() => {
    const stringCanvas = stringRef.current
    const waveCanvas = waveRef.current
    if (!stringCanvas || !waveCanvas) return

    const dpr = window.devicePixelRatio || 1
    const setupCanvas = (c: HTMLCanvasElement) => {
      const rect = c.getBoundingClientRect()
      c.width = rect.width * dpr
      c.height = rect.height * dpr
      const ctx = c.getContext('2d')!
      ctx.scale(dpr, dpr)
      return { ctx, w: rect.width, h: rect.height }
    }

    let strip = setupCanvas(stringCanvas)
    let wave = setupCanvas(waveCanvas)

    const handleResize = () => {
      strip = setupCanvas(stringCanvas)
      wave = setupCanvas(waveCanvas)
    }
    window.addEventListener('resize', handleResize)

    const physicsStep = (dt: number) => {
      const y = yRef.current
      const yPrev = yPrevRef.current
      const yNext = yNextRef.current
      const c2 = tensionRef.current
      const damp = dampingRef.current
      const t = timeRef.current
      const mode = modeRef.current
      const end = endTypeRef.current

      if (mode === 'oscillate') {
        y[0] = driveAmpRef.current * Math.sin(2 * Math.PI * driveFreqRef.current * t)
      } else if (mode === 'manual') {
        if (draggingRef.current) {
          // "Smooth stroke" applies an exponential moving average to the
          // raw pointer position — this is what actually fixes the
          // "can't make a clean sine by hand" problem: real mouse input
          // is jittery high-frequency noise riding on top of your
          // intended rhythm, and a low-pass filter removes exactly that
          // noise while keeping your rhythm intact. It never touches the
          // string's own physics (tension/damping/wave speed), only the
          // hand's input signal.
          if (smoothStrokeRef.current) {
            const alpha = 0.12
            smoothedDragYRef.current += (dragYRef.current - smoothedDragYRef.current) * alpha
            y[0] = smoothedDragYRef.current
          } else {
            y[0] = dragYRef.current
            smoothedDragYRef.current = dragYRef.current
          }
          manualHoldRef.current = y[0]
        } else {
          y[0] = manualHoldRef.current
        }
      } else {
        y[0] = 0
      }

      for (let i = 1; i < N - 1; i++) {
        const laplacian = y[i + 1] - 2 * y[i] + y[i - 1]
        yNext[i] = (2 * y[i] - yPrev[i] + c2 * laplacian) * damp
      }

      if (end === 'fixed') {
        yNext[N - 1] = 0
      } else if (end === 'loose') {
        yNext[N - 1] = yNext[N - 2]
      } else {
        // 'none': a first-order Mur absorbing boundary condition — the
        // standard non-reflecting termination for a 1D wave equation.
        // r is the Courant number (wave speed in grid units); the
        // formula lets the wave exit through this boundary with
        // (ideally) zero reflected energy instead of bouncing back.
        const r = Math.sqrt(c2)
        const coef = (r - 1) / (r + 1)
        yNext[N - 1] = y[N - 2] + coef * (yNext[N - 2] - y[N - 1])
      }
      yNext[0] = y[0]

      yPrevRef.current = y
      yRef.current = yNext
      yNextRef.current = yPrev

      timeRef.current += dt
      historyRef.current.push({ t: timeRef.current, y: yRef.current[Math.floor(N / 2)] })
      const cutoff = timeRef.current - WINDOW_SECONDS - 1
      while (historyRef.current.length && historyRef.current[0].t < cutoff) {
        historyRef.current.shift()
      }
    }

    const drawLeftIcon = (ctx: CanvasRenderingContext2D, x: number, y: number, colors: Colors) => {
      const mode = modeRef.current
      ctx.save()
      ctx.translate(x, y)
      if (mode === 'oscillate') {
        ctx.beginPath()
        ctx.arc(0, 0, 16, 0, Math.PI * 2)
        ctx.strokeStyle = colors.brass
        ctx.lineWidth = 3
        ctx.stroke()
        const angle = timeRef.current * driveFreqRef.current * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(Math.cos(angle) * 14, Math.sin(angle) * 14)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(0, 0, 3, 0, Math.PI * 2)
        ctx.fillStyle = colors.brass
        ctx.fill()
      } else if (mode === 'manual') {
        ctx.fillStyle = draggingRef.current ? colors.drive : colors.brass
        ctx.fillRect(-8, -18, 16, 36)
        ctx.strokeStyle = colors.axis
        ctx.lineWidth = 1.5
        ctx.strokeRect(-8, -18, 16, 36)
      } else {
        ctx.strokeStyle = colors.brass
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(-14, 0)
        ctx.lineTo(4, 0)
        ctx.moveTo(-2, -8)
        ctx.lineTo(4, 0)
        ctx.lineTo(-2, 8)
        ctx.stroke()
      }
      ctx.restore()
    }

    const drawRightIcon = (ctx: CanvasRenderingContext2D, x: number, y: number, colors: Colors) => {
      const end = endTypeRef.current
      ctx.save()
      ctx.translate(x, y)
      if (end === 'fixed') {
        ctx.fillStyle = colors.axis
        ctx.fillRect(-4, -22, 14, 44)
        ctx.fillRect(-16, -22, 12, 10)
        ctx.fillRect(-16, 12, 12, 10)
      } else if (end === 'loose') {
        ctx.strokeStyle = colors.brass
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(0, 0, 12, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        ctx.strokeStyle = colors.guide
        ctx.lineWidth = 2
        ctx.setLineDash([4, 5])
        ctx.globalAlpha = 0.7
        ctx.beginPath()
        ctx.moveTo(-14, 0)
        ctx.lineTo(18, 0)
        ctx.stroke()
        ctx.setLineDash([])
      }
      ctx.restore()
    }

    const drawString = () => {
      const colors = colorsRef.current
      if (!colors) return
      const { ctx, w, h } = strip
      const y = yRef.current
      const midY = h / 2
      const dx = w / (N - 1)

      ctx.clearRect(0, 0, w, h)

      if (showReference) {
        ctx.strokeStyle = colors.axis
        ctx.globalAlpha = 0.4
        ctx.setLineDash([5, 5])
        ctx.beginPath()
        ctx.moveTo(0, midY)
        ctx.lineTo(w, midY)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }

      ctx.strokeStyle = colors.string
      ctx.lineWidth = 2.5
      ctx.beginPath()
      for (let i = 0; i < N; i++) {
        const px = i * dx
        const py = midY - y[i]
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()

      drawLeftIcon(ctx, 14, midY - y[0], colors)
      drawRightIcon(ctx, w - 8, midY - y[N - 1], colors)

      const mid = Math.floor(N / 2)
      ctx.beginPath()
      ctx.arc(mid * dx, midY - y[mid], 5, 0, Math.PI * 2)
      ctx.fillStyle = colors.node
      ctx.fill()

      if (showRuler) {
        drawDraggableRuler(ctx, rulerPosRef.current, colors)
      }
      if (showStopwatch) {
        drawDraggableStopwatch(
          ctx,
          stopwatchPosRef.current,
          timeRef.current - stopwatchOffsetRef.current,
          colors,
        )
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
      const tMin = tNow - WINDOW_SECONDS
      const scale = Math.min(1, (h / 2 - 8) / 110)

      ctx.strokeStyle = colors.node
      ctx.lineWidth = 2
      ctx.beginPath()
      let started = false
      for (const p of hist) {
        if (p.t < tMin) continue
        const px = ((p.t - tMin) / WINDOW_SECONDS) * w
        const py = midY - p.y * scale
        if (!started) {
          ctx.moveTo(px, py)
          started = true
        } else {
          ctx.lineTo(px, py)
        }
      }
      ctx.stroke()
    }

    let lastTs: number | null = null
    const animate = (ts: number) => {
      if (lastTs == null) lastTs = ts
      const rawDt = Math.min((ts - lastTs) / 1000, 0.033)
      const dt = speedRef.current === 'slow' ? rawDt * 0.3 : rawDt
      lastTs = ts

      if (runningRef.current) {
        physicsStep(dt)
      } else if (stepRequestRef.current) {
        stepRequestRef.current = false
        // Fixed-size step, independent of frame rate — split into
        // sub-steps so a 0.1s jump stays numerically stable even at
        // high tension.
        const sub = 8
        for (let i = 0; i < sub; i++) physicsStep(STEP_DT / sub)
      }

      drawString()
      drawWave()
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)

    const updateDrag = (clientY: number) => {
      const rect = stringCanvas.getBoundingClientRect()
      const midY = rect.height / 2
      dragYRef.current = Math.max(-140, Math.min(140, midY - (clientY - rect.top)))
    }

    const onPointerDown = (e: PointerEvent) => {
      const rect = stringCanvas.getBoundingClientRect()
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

      if (modeRef.current !== 'manual') return
      draggingRef.current = true
      updateDrag(e.clientY)
    }
    const onPointerMove = (e: PointerEvent) => {
      const rect = stringCanvas.getBoundingClientRect()
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
      updateDrag(e.clientY)
    }
    const onPointerUp = () => {
      draggingRef.current = false
      draggedToolRef.current = null
    }
    stringCanvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', handleResize)
      stringCanvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReference, showRuler, showStopwatch])

  return (
    <div className="sim">
      <div className="sim__header">
        <button className="sim__back" onClick={onBack}>
          ← Cabinet
        </button>
        <div className="sim__plate-label">
          <span className="mono">SPECIMEN NO. 03</span>
          <h2>Wave on a String</h2>
        </div>
      </div>

      <div className="sim__body">
        <div className="sim__viewport">
          <div className="sim__panel sim__panel--string">
            <div className="sim__overlay sim__overlay--left">
              <RadioGroup<SourceMode>
                options={[
                  { value: 'manual', label: 'Manual' },
                  { value: 'oscillate', label: 'Oscillate' },
                  { value: 'pulse', label: 'Pulse' },
                ]}
                value={mode}
                onChange={setMode}
              />
            </div>
            <div className="sim__overlay sim__overlay--right">
              <RadioGroup<EndType>
                options={[
                  { value: 'fixed', label: 'Fixed End' },
                  { value: 'loose', label: 'Loose End' },
                  { value: 'none', label: 'No End' },
                ]}
                value={endType}
                onChange={setEndType}
              />
            </div>
            <canvas ref={stringRef} className="sim__canvas" />
          </div>
          <div className="sim__panel sim__panel--wave">
            <div className="sim__wave-legend">
              <span className="mono" style={{ color: 'var(--rust)' }}>
                y(t) — midpoint displacement
              </span>
            </div>
            <canvas ref={waveRef} className="sim__canvas sim__canvas--wave" />
          </div>
        </div>

        <div className="sim__controls">
          {mode === 'oscillate' && (
            <div className="sim__control-group">
              <Dial label="Drive frequency" value={driveFreq} min={0.1} max={3} step={0.05} unit="Hz" onChange={setDriveFreq} />
              <Dial label="Drive amplitude" value={driveAmp} min={5} max={110} step={1} unit="px" onChange={setDriveAmp} />
            </div>
          )}
          {mode === 'manual' && (
            <div className="sim__control-group">
              <Checkbox
                label="Smooth stroke (steadier sine)"
                checked={smoothStroke}
                onChange={setSmoothStroke}
              />
            </div>
          )}
          {mode === 'pulse' && (
            <div className="sim__control-group">
              <button className="sim__btn sim__btn--primary" onClick={sendPulse}>
                Send pulse
              </button>
            </div>
          )}

          <div className="sim__control-group">
            <Dial label="Tension (c²)" value={tension} min={0.05} max={0.95} step={0.01} onChange={setTension} />
            <Dial label="Damping" value={damping} min={0.99} max={1} step={0.0005} onChange={setDamping} />
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
            <Checkbox label="Reference line" checked={showReference} onChange={setShowReference} />
            <Checkbox label="Ruler" checked={showRuler} onChange={setShowRuler} />
            <Checkbox label="Stopwatch" checked={showStopwatch} onChange={setShowStopwatch} />
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
            <button className="sim__btn" onClick={reset}>
              Reset
            </button>
          </div>

          <p className="sim__note">
            <strong>Manual</strong> — with "Smooth stroke" on, your rough
            hand motion gets filtered into a clean, steady wave (the
            physics itself is untouched — only the noisy human input is
            smoothed); turn it off for raw, unfiltered hand control.{' '}
            <strong>No End</strong> now uses a proper absorbing boundary
            so the wave actually leaves instead of bouncing back. Drag
            the ruler or stopwatch by their body to move them; click the
            small dot on the stopwatch to zero it.
          </p>
        </div>
      </div>
    </div>
  )
}
