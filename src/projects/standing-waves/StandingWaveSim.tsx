import { useEffect, useRef, useState } from 'react'
import Dial from '../../components/Dial'
import RadioGroup from '../../components/RadioGroup'
import Checkbox from '../../components/Checkbox'
import type { Theme } from '../../lib/useTheme'
import './StandingWaveSim.css'

interface Props {
  theme: Theme
  onBack: () => void
}

interface Colors {
  axis: string
  guide: string
  string: string
  node: string
  antinode: string
  right: string
  left: string
  strain: string
  text: string
}

type Speed = 'normal' | 'slow'

const MOLECULES = 46
const L = 1 // normalized string length (meters, conceptually)

export default function StandingWaveSim({ theme, onBack }: Props) {
  const stringRef = useRef<HTMLCanvasElement>(null)
  const strainRef = useRef<HTMLCanvasElement>(null)
  const colorsRef = useRef<Colors | null>(null)
  const timeRef = useRef(0)
  const rafRef = useRef<number>(0)
  const stepRequestRef = useRef(false)

  const [harmonic, setHarmonic] = useState(2) // n = 1, 2, 3...
  const [waveSpeed, setWaveSpeed] = useState(0.6) // m/s, normalized
  const [amplitude, setAmplitude] = useState(90) // px
  const [speed, setSpeed] = useState<Speed>('normal')
  const [running, setRunning] = useState(true)
  const [showComponents, setShowComponents] = useState(true)
  const [showStrain, setShowStrain] = useState(true)

  const harmonicRef = useRef(harmonic)
  const waveSpeedRef = useRef(waveSpeed)
  const amplitudeRef = useRef(amplitude)
  const speedRef = useRef(speed)
  const runningRef = useRef(running)
  const showComponentsRef = useRef(showComponents)

  useEffect(() => {
    harmonicRef.current = harmonic
  }, [harmonic])
  useEffect(() => {
    waveSpeedRef.current = waveSpeed
  }, [waveSpeed])
  useEffect(() => {
    amplitudeRef.current = amplitude
  }, [amplitude])
  useEffect(() => {
    speedRef.current = speed
  }, [speed])
  useEffect(() => {
    runningRef.current = running
  }, [running])
  useEffect(() => {
    showComponentsRef.current = showComponents
  }, [showComponents])

  useEffect(() => {
    const s = getComputedStyle(document.documentElement)
    const get = (name: string) => s.getPropertyValue(name).trim()
    colorsRef.current = {
      axis: get('--panel-border'),
      guide: get('--text-muted'),
      string: get('--text'),
      node: get('--text-muted'),
      antinode: get('--brass-bright'),
      right: get('--teal'),
      left: get('--rust'),
      strain: get('--violet'),
      text: get('--text-muted'),
    }
  }, [theme])

  const reset = () => {
    timeRef.current = 0
  }

  // The exact normal-mode solution for a string fixed at both ends:
  //   y(x,t) = A sin(n*pi*x/L) * cos(omega*t)
  // computed here as the literal sum of two counter-propagating waves
  // (rather than the collapsed closed form) so the "component waves"
  // overlay is guaranteed mathematically consistent with what's drawn
  // as the resultant — there's no separate formula to fall out of sync.
  const evaluate = (x: number, t: number, n: number, v: number, A: number) => {
    const k = (n * Math.PI) / L
    const omega = k * v
    const half = A / 2
    const right = half * Math.sin(k * x - omega * t) // travels +x
    const left = half * Math.sin(k * x + omega * t) // travels -x
    return { right, left, sum: right + left, k, omega }
  }

  useEffect(() => {
    const stringCanvas = stringRef.current
    const strainCanvas = strainRef.current
    if (!stringCanvas || !strainCanvas) return

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
    let strain = setupCanvas(strainCanvas)

    const handleResize = () => {
      strip = setupCanvas(stringCanvas)
      strain = setupCanvas(strainCanvas)
    }
    window.addEventListener('resize', handleResize)

    const drawString = () => {
      const colors = colorsRef.current
      if (!colors) return
      const { ctx, w, h } = strip
      const midY = h / 2
      const n = harmonicRef.current
      const v = waveSpeedRef.current
      const A = amplitudeRef.current
      const t = timeRef.current
      const k = (n * Math.PI) / L

      ctx.clearRect(0, 0, w, h)

      // equilibrium reference
      ctx.strokeStyle = colors.axis
      ctx.globalAlpha = 0.4
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(0, midY)
      ctx.lineTo(w, midY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1

      // envelope (max possible displacement at each x, i.e. |A sin(kx)|)
      ctx.strokeStyle = colors.guide
      ctx.globalAlpha = 0.3
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i <= 200; i++) {
        const x = (i / 200) * L
        const px = (x / L) * w
        const py = midY - A * Math.sin(k * x)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
      ctx.beginPath()
      for (let i = 0; i <= 200; i++) {
        const x = (i / 200) * L
        const px = (x / L) * w
        const py = midY + A * Math.sin(k * x)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
      ctx.globalAlpha = 1

      // component traveling waves (thin dashed), whose sum IS the
      // resultant drawn below
      if (showComponentsRef.current) {
        const drawComponent = (pick: (x: number) => number, color: string) => {
          ctx.strokeStyle = color
          ctx.lineWidth = 1.5
          ctx.globalAlpha = 0.75
          ctx.setLineDash([3, 4])
          ctx.beginPath()
          for (let i = 0; i <= 200; i++) {
            const x = (i / 200) * L
            const px = (x / L) * w
            const py = midY - pick(x)
            if (i === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          }
          ctx.stroke()
          ctx.setLineDash([])
          ctx.globalAlpha = 1
        }
        drawComponent((x) => evaluate(x, t, n, v, A).right, colors.right)
        drawComponent((x) => evaluate(x, t, n, v, A).left, colors.left)
      }

      // resultant standing wave (solid, bold) — the literal sum of the
      // two components above
      ctx.strokeStyle = colors.string
      ctx.lineWidth = 3
      ctx.beginPath()
      for (let i = 0; i <= 200; i++) {
        const x = (i / 200) * L
        const px = (x / L) * w
        const py = midY - evaluate(x, t, n, v, A).sum
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()

      // molecules: evenly spaced particles with a vertical trail line
      // from equilibrium to their current position, so the "up-down"
      // oscillation reads clearly at a glance
      for (let i = 0; i < MOLECULES; i++) {
        const x = (i / (MOLECULES - 1)) * L
        const px = (x / L) * w
        const y = evaluate(x, t, n, v, A).sum
        const py = midY - y

        // is this molecule effectively at a node? (sin(kx) near zero)
        const isNode = Math.abs(Math.sin(k * x)) < 0.04

        ctx.strokeStyle = colors.guide
        ctx.globalAlpha = 0.5
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(px, midY)
        ctx.lineTo(px, py)
        ctx.stroke()
        ctx.globalAlpha = 1

        ctx.beginPath()
        ctx.arc(px, py, isNode ? 3 : 4.5, 0, Math.PI * 2)
        ctx.fillStyle = isNode ? colors.node : colors.antinode
        ctx.fill()
      }

      // explicit node markers on the axis
      for (let m = 0; m <= n; m++) {
        const x = (m / n) * L
        const px = (x / L) * w
        ctx.beginPath()
        ctx.arc(px, midY, 5, 0, Math.PI * 2)
        ctx.fillStyle = colors.node
        ctx.fill()
        ctx.strokeStyle = colors.axis
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }

    const drawStrain = () => {
      const colors = colorsRef.current
      if (!colors || !showStrain) {
        strain.ctx.clearRect(0, 0, strain.w, strain.h)
        return
      }
      const { ctx, w, h } = strain
      const midY = h * 0.85
      const n = harmonicRef.current
      const v = waveSpeedRef.current
      const A = amplitudeRef.current
      const t = timeRef.current
      const k = (n * Math.PI) / L
      const omega = k * v

      ctx.clearRect(0, 0, w, h)
      ctx.strokeStyle = colors.axis
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.moveTo(0, midY)
      ctx.lineTo(w, midY)
      ctx.stroke()
      ctx.globalAlpha = 1

      // envelope: max |strain| over a cycle at each x, ∝ |cos(kx)|
      const strainScale = (h * 0.75) / (A * k)
      ctx.strokeStyle = colors.guide
      ctx.globalAlpha = 0.35
      ctx.beginPath()
      for (let i = 0; i <= 200; i++) {
        const x = (i / 200) * L
        const px = (x / L) * w
        const envelope = A * k * Math.abs(Math.cos(k * x))
        const py = midY - envelope * strainScale
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
      ctx.globalAlpha = 1

      // instantaneous strain ∝ ∂y/∂x = A*k*cos(kx)*cos(wt)
      ctx.strokeStyle = colors.strain
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let i = 0; i <= 200; i++) {
        const x = (i / 200) * L
        const px = (x / L) * w
        const strainVal = A * k * Math.cos(k * x) * Math.cos(omega * t)
        const py = midY - strainVal * strainScale
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    }

    let lastTs: number | null = null
    const advance = (dt: number) => {
      timeRef.current += dt
    }
    const animate = (ts: number) => {
      if (lastTs == null) lastTs = ts
      const rawDt = Math.min((ts - lastTs) / 1000, 0.033)
      const dt = speedRef.current === 'slow' ? rawDt * 0.3 : rawDt
      lastTs = ts

      if (runningRef.current) {
        advance(dt)
      } else if (stepRequestRef.current) {
        stepRequestRef.current = false
        advance(0.1)
      }

      drawString()
      drawStrain()
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', handleResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showStrain])

  const v = waveSpeed
  const freq = (harmonic * v) / (2 * L)
  const wavelength = (2 * L) / harmonic

  return (
    <div className="sim">
      <div className="sim__header">
        <button className="sim__back" onClick={onBack}>
          ← Cabinet
        </button>
        <div className="sim__plate-label">
          <span className="mono">SPECIMEN NO. 06</span>
          <h2>Standing Waves</h2>
        </div>
      </div>

      <div className="sim__body">
        <div className="sim__viewport">
          <div className="sim__panel sim__panel--string">
            <canvas ref={stringRef} className="sim__canvas" />
          </div>
          <div className="sim__panel sim__panel--wave">
            <div className="sim__wave-legend">
              <span className="mono" style={{ color: 'var(--violet)' }}>
                strain ∝ ∂y/∂x — max at nodes, zero at antinodes
              </span>
            </div>
            <canvas ref={strainRef} className="sim__canvas sim__canvas--wave" />
          </div>
        </div>

        <div className="sim__controls">
          <div className="sim__control-group">
            <Dial label="Harmonic (n)" value={harmonic} min={1} max={8} step={1} onChange={setHarmonic} />
            <Dial label="Wave speed" value={waveSpeed} min={0.2} max={1.2} step={0.05} unit="m/s" onChange={setWaveSpeed} />
            <Dial label="Amplitude" value={amplitude} min={20} max={130} step={5} unit="px" onChange={setAmplitude} />
          </div>

          <div className="sim__control-group">
            <Checkbox label="Show component traveling waves" checked={showComponents} onChange={setShowComponents} />
            <Checkbox label="Show strain / stress graph" checked={showStrain} onChange={setShowStrain} />
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
            n = {harmonic} gives {harmonic + 1} nodes (fixed points, gray)
            and {harmonic} antinodes (max-swing points, brass) —{' '}
            <code className="mono">
              f = nv/2L ≈ {freq.toFixed(2)} Hz, λ = 2L/n ≈ {wavelength.toFixed(2)}
            </code>
            . The dashed teal and rust curves are two equal waves
            traveling in opposite directions; their sum, drawn solid, is
            exactly the standing wave — nowhere does energy actually
            travel left or right, it just sloshes between the antinodes.
            The string is flattest (least strain) right at the
            antinodes and steepest (most strain — where the string is
            under the most stress) at the nodes, even though the nodes
            never move at all.
          </p>
        </div>
      </div>
    </div>
  )
}
