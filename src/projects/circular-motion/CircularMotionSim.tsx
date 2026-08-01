import { useEffect, useRef, useState } from 'react'
import Dial from '../../components/Dial'
import Switch from '../../components/Switch'
import type { Theme } from '../../lib/useTheme'
import './CircularMotionSim.css'

interface Props {
  theme: Theme
  onBack: () => void
}

interface Colors {
  axis: string
  guide: string
  particle: string
  x: string
  y: string
  velocity: string
  accel: string
  text: string
}

interface HistoryPoint {
  t: number
  x: number
  y: number
}

const WINDOW_SECONDS = 6

export default function CircularMotionSim({ theme, onBack }: Props) {
  const orbitRef = useRef<HTMLCanvasElement>(null)
  const waveRef = useRef<HTMLCanvasElement>(null)
  const colorsRef = useRef<Colors | null>(null)
  const historyRef = useRef<HistoryPoint[]>([])
  const timeRef = useRef(0)
  const lastTsRef = useRef<number | null>(null)
  const rafRef = useRef<number>(0)

  const [amplitude, setAmplitude] = useState(120) // pixels
  const [omega, setOmega] = useState(1) // rad/s
  const [running, setRunning] = useState(true)
  const [showVelocity, setShowVelocity] = useState(true)
  const [showAccel, setShowAccel] = useState(false)
  const [showTrail, setShowTrail] = useState(true)

  const amplitudeRef = useRef(amplitude)
  const omegaRef = useRef(omega)
  const runningRef = useRef(running)
  const showVelocityRef = useRef(showVelocity)
  const showAccelRef = useRef(showAccel)
  const showTrailRef = useRef(showTrail)

  useEffect(() => {
    amplitudeRef.current = amplitude
  }, [amplitude])
  useEffect(() => {
    omegaRef.current = omega
  }, [omega])
  useEffect(() => {
    runningRef.current = running
  }, [running])
  useEffect(() => {
    showVelocityRef.current = showVelocity
  }, [showVelocity])
  useEffect(() => {
    showAccelRef.current = showAccel
  }, [showAccel])
  useEffect(() => {
    showTrailRef.current = showTrail
  }, [showTrail])

  // Re-read theme colors from CSS variables whenever the theme changes
  useEffect(() => {
    const s = getComputedStyle(document.documentElement)
    const get = (name: string) => s.getPropertyValue(name).trim()
    colorsRef.current = {
      axis: get('--panel-border'),
      guide: get('--text-muted'),
      particle: get('--text'),
      x: get('--teal'),
      y: get('--rust'),
      velocity: get('--brass-bright'),
      accel: get('--violet'),
      text: get('--text-muted'),
    }
  }, [theme])

  const reset = () => {
    timeRef.current = 0
    historyRef.current = []
  }

  useEffect(() => {
    const orbitCanvas = orbitRef.current
    const waveCanvas = waveRef.current
    if (!orbitCanvas || !waveCanvas) return

    const dpr = window.devicePixelRatio || 1
    const setupCanvas = (c: HTMLCanvasElement) => {
      const rect = c.getBoundingClientRect()
      c.width = rect.width * dpr
      c.height = rect.height * dpr
      const ctx = c.getContext('2d')!
      ctx.scale(dpr, dpr)
      return { ctx, w: rect.width, h: rect.height }
    }

    let orbit = setupCanvas(orbitCanvas)
    let wave = setupCanvas(waveCanvas)

    const handleResize = () => {
      orbit = setupCanvas(orbitCanvas)
      wave = setupCanvas(waveCanvas)
    }
    window.addEventListener('resize', handleResize)

    const drawOrbit = (t: number) => {
      const colors = colorsRef.current
      if (!colors) return
      const { ctx, w, h } = orbit
      const cx = w / 2
      const cy = h / 2
      const A = amplitudeRef.current
      const w0 = omegaRef.current

      ctx.clearRect(0, 0, w, h)

      const px = A * Math.cos(w0 * t)
      const py = A * Math.sin(w0 * t)

      // trail
      if (showTrailRef.current) {
        const trailLen = 24
        for (let i = 0; i < trailLen; i++) {
          const tt = t - i * 0.02
          const tx = cx + A * Math.cos(w0 * tt)
          const ty = cy - A * Math.sin(w0 * tt)
          ctx.beginPath()
          ctx.arc(tx, ty, 3, 0, Math.PI * 2)
          ctx.globalAlpha = 1 - i / trailLen
          ctx.fillStyle = colors.particle
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }

      // reference circle
      ctx.beginPath()
      ctx.arc(cx, cy, A, 0, Math.PI * 2)
      ctx.strokeStyle = colors.guide
      ctx.globalAlpha = 0.35
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.globalAlpha = 1

      // axes
      ctx.strokeStyle = colors.axis
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx - A - 24, cy)
      ctx.lineTo(cx + A + 24, cy)
      ctx.moveTo(cx, cy - A - 24)
      ctx.lineTo(cx, cy + A + 24)
      ctx.stroke()

      const particleX = cx + px
      const particleY = cy - py
      const projX = cx + px
      const projY = cy
      const projYx = cx
      const projYy = cy - py

      // dashed guide: particle -> x projection
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = colors.x
      ctx.globalAlpha = 0.6
      ctx.beginPath()
      ctx.moveTo(particleX, particleY)
      ctx.lineTo(projX, projY)
      ctx.stroke()

      // dashed guide: particle -> y projection
      ctx.strokeStyle = colors.y
      ctx.beginPath()
      ctx.moveTo(particleX, particleY)
      ctx.lineTo(projYx, projYy)
      ctx.stroke()

      // connecting line between the two projections
      ctx.strokeStyle = colors.guide
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.moveTo(projX, projY)
      ctx.lineTo(projYx, projYy)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1

      // velocity vector (tangent, scaled)
      if (showVelocityRef.current) {
        const vx = -A * w0 * Math.sin(w0 * t)
        const vy = A * w0 * Math.cos(w0 * t)
        drawArrow(
          ctx,
          particleX,
          particleY,
          particleX + vx * 0.3,
          particleY - vy * 0.3,
          colors.velocity,
        )
      }

      // acceleration vector (points to center, scaled)
      if (showAccelRef.current) {
        const ax = -A * w0 * w0 * Math.cos(w0 * t)
        const ay = -A * w0 * w0 * Math.sin(w0 * t)
        drawArrow(
          ctx,
          particleX,
          particleY,
          particleX + ax * 0.15,
          particleY - ay * 0.15,
          colors.accel,
        )
      }

      // x projection dot
      ctx.beginPath()
      ctx.arc(projX, projY, 5, 0, Math.PI * 2)
      ctx.fillStyle = colors.x
      ctx.fill()

      // y projection dot
      ctx.beginPath()
      ctx.arc(projYx, projYy, 5, 0, Math.PI * 2)
      ctx.fillStyle = colors.y
      ctx.fill()

      // particle
      ctx.beginPath()
      ctx.arc(particleX, particleY, 7, 0, Math.PI * 2)
      ctx.fillStyle = colors.particle
      ctx.fill()
    }

    const drawWave = () => {
      const colors = colorsRef.current
      if (!colors) return
      const { ctx, w, h } = wave
      ctx.clearRect(0, 0, w, h)

      const midY = h / 2
      const A = amplitudeRef.current
      const scale = Math.min(1, (h / 2 - 10) / Math.max(A, 1))

      // midline
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

      const plot = (key: 'x' | 'y', color: string) => {
        ctx.beginPath()
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        let started = false
        for (const p of hist) {
          if (p.t < tMin) continue
          const px = ((p.t - tMin) / WINDOW_SECONDS) * w
          const py = midY - p[key] * scale
          if (!started) {
            ctx.moveTo(px, py)
            started = true
          } else {
            ctx.lineTo(px, py)
          }
        }
        ctx.stroke()
      }

      plot('x', colors.x)
      plot('y', colors.y)
    }

    const animate = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts
      const dt = (ts - lastTsRef.current) / 1000
      lastTsRef.current = ts

      if (runningRef.current) {
        timeRef.current += dt
        const A = amplitudeRef.current
        const w0 = omegaRef.current
        const t = timeRef.current
        historyRef.current.push({
          t,
          x: A * Math.cos(w0 * t),
          y: A * Math.sin(w0 * t),
        })
        const cutoff = t - WINDOW_SECONDS - 1
        while (historyRef.current.length && historyRef.current[0].t < cutoff) {
          historyRef.current.shift()
        }
      }

      drawOrbit(timeRef.current)
      drawWave()
      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', handleResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="sim">
      <div className="sim__header">
        <button className="sim__back" onClick={onBack}>
          ← Cabinet
        </button>
        <div className="sim__plate-label">
          <span className="mono">SPECIMEN NO. 01</span>
          <h2>Circular Motion &amp; SHM</h2>
        </div>
      </div>

      <div className="sim__body">
        <div className="sim__viewport">
          <div className="sim__panel sim__panel--orbit">
            <canvas ref={orbitRef} className="sim__canvas" />
          </div>
          <div className="sim__panel sim__panel--wave">
            <div className="sim__wave-legend">
              <span className="mono" style={{ color: 'var(--teal)' }}>
                x(t) — horizontal shadow
              </span>
              <span className="mono" style={{ color: 'var(--rust)' }}>
                y(t) — vertical shadow
              </span>
            </div>
            <canvas ref={waveRef} className="sim__canvas sim__canvas--wave" />
          </div>
        </div>

        <div className="sim__controls">
          <div className="sim__control-group">
            <Dial
              label="Amplitude"
              value={amplitude}
              min={40}
              max={170}
              step={1}
              unit="px"
              onChange={setAmplitude}
            />
            <Dial
              label="Angular frequency (ω)"
              value={omega}
              min={0.2}
              max={4}
              step={0.05}
              unit="rad/s"
              onChange={setOmega}
            />
          </div>

          <div className="sim__control-group">
            <Switch
              label="Velocity vector"
              checked={showVelocity}
              onChange={setShowVelocity}
              swatch="var(--brass-bright)"
            />
            <Switch
              label="Acceleration vector"
              checked={showAccel}
              onChange={setShowAccel}
              swatch="var(--violet)"
            />
            <Switch
              label="Motion trail"
              checked={showTrail}
              onChange={setShowTrail}
            />
          </div>

          <div className="sim__buttons">
            <button
              className="sim__btn sim__btn--primary"
              onClick={() => setRunning((r) => !r)}
            >
              {running ? 'Pause' : 'Play'}
            </button>
            <button className="sim__btn" onClick={reset}>
              Reset
            </button>
          </div>

          <p className="sim__note">
            The particle circles at constant speed. Its horizontal shadow
            (teal) and vertical shadow (rust) each trace simple harmonic
            motion, 90° out of phase. Acceleration always points back toward
            the center — that's the <code className="mono">a = −ω²x</code>{' '}
            relationship, made visible.
          </p>
        </div>
      </div>
    </div>
  )
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
) {
  const headLen = 8
  const angle = Math.atan2(y2 - y1, x2 - x1)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6),
  )
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6),
  )
  ctx.closePath()
  ctx.fill()
}
