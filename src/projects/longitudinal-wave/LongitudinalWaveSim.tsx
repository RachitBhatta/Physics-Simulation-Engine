import { useEffect, useRef, useState } from 'react'
import Dial from '../../components/Dial'
import Switch from '../../components/Switch'
import type { Theme } from '../../lib/useTheme'
// @ts-ignore: Allow CSS side-effect import without module declarations
import './LongitudinalWaveSim.css'

interface Props {
  theme: Theme
  onBack: () => void
}

interface Colors {
  axis: string
  guide: string
  compressed: { r: number; g: number; b: number }
  rarefied: { r: number; g: number; b: number }
  drive: string
  tracked: string
  text: string
}

// Number of beads in the chain. Each bead is a point mass; adjacent
// beads are coupled by an imaginary spring (Hooke's law), exactly the
// textbook model for how sound propagates through a solid or a slinky.
const M = 60
const WINDOW_SECONDS = 6
const TRACKED_INDEX = Math.floor(M * 0.55)

export default function LongitudinalWaveSim({ theme, onBack }: Props) {
  const chainRef = useRef<HTMLCanvasElement>(null)
  const waveRef = useRef<HTMLCanvasElement>(null)
  const colorsRef = useRef<Colors | null>(null)

  // u[i] is the displacement of bead i along the propagation axis (x),
  // measured from its equilibrium position i * spacing. This is the
  // defining feature of a longitudinal wave: the oscillation direction
  // is parallel to the direction the wave travels, not perpendicular
  // to it like the string sim.
  const uRef = useRef<Float32Array>(new Float32Array(M))
  const uPrevRef = useRef<Float32Array>(new Float32Array(M))
  const uNextRef = useRef<Float32Array>(new Float32Array(M))

  const timeRef = useRef(0)
  const historyRef = useRef<{ t: number; u: number }[]>([])
  const rafRef = useRef<number>(0)

  const [stiffness, setStiffness] = useState(0.5) // Courant number squared
  const [damping, setDamping] = useState(0.999)
  const [driveOn, setDriveOn] = useState(true)
  const [driveFreq, setDriveFreq] = useState(0.5)
  const [driveAmp, setDriveAmp] = useState(10)
  const [fixedRightEnd, setFixedRightEnd] = useState(false)
  const [running, setRunning] = useState(true)

  const stiffnessRef = useRef(stiffness)
  const dampingRef = useRef(damping)
  const driveOnRef = useRef(driveOn)
  const driveFreqRef = useRef(driveFreq)
  const driveAmpRef = useRef(driveAmp)
  const fixedRightEndRef = useRef(fixedRightEnd)
  const runningRef = useRef(running)

  useEffect(() => {
    stiffnessRef.current = stiffness
  }, [stiffness])
  useEffect(() => {
    dampingRef.current = damping
  }, [damping])
  useEffect(() => {
    driveOnRef.current = driveOn
  }, [driveOn])
  useEffect(() => {
    driveFreqRef.current = driveFreq
  }, [driveFreq])
  useEffect(() => {
    driveAmpRef.current = driveAmp
  }, [driveAmp])
  useEffect(() => {
    fixedRightEndRef.current = fixedRightEnd
  }, [fixedRightEnd])
  useEffect(() => {
    runningRef.current = running
  }, [running])

  useEffect(() => {
    const s = getComputedStyle(document.documentElement)
    const get = (name: string) => s.getPropertyValue(name).trim()
    const rust = hexToRgb(get('--rust')) ?? { r: 166, g: 67, b: 45 }
    const teal = hexToRgb(get('--teal')) ?? { r: 47, g: 111, b: 98 }
    colorsRef.current = {
      axis: get('--panel-border'),
      guide: get('--text-muted'),
      compressed: rust, // dense, particles crowded together
      rarefied: teal, // sparse, particles spread apart
      drive: get('--brass-bright'),
      tracked: get('--rust'),
      text: get('--text-muted'),
    }
  }, [theme])

  const reset = () => {
    uRef.current.fill(0)
    uPrevRef.current.fill(0)
    uNextRef.current.fill(0)
    timeRef.current = 0
    historyRef.current = []
  }

  // Push a single compression pulse in from the left, the way tapping
  // the end of a slinky does — a localized bunching-up that then
  // travels down the chain.
  const pushPulse = () => {
    const u = uRef.current
    const uPrev = uPrevRef.current
    const halfWidth = 6
    for (let i = 1; i <= halfWidth * 2 && i < M - 1; i++) {
      const frac = (i - halfWidth) / halfWidth
      const shape = 0.5 * (1 + Math.cos(Math.PI * Math.min(1, Math.abs(frac))))
      u[i] = 14 * shape
      uPrev[i] = u[i]
    }
  }

  useEffect(() => {
    const chainCanvas = chainRef.current
    const waveCanvas = waveRef.current
    if (!chainCanvas || !waveCanvas) return

    const dpr = window.devicePixelRatio || 1
    const setupCanvas = (c: HTMLCanvasElement) => {
      const rect = c.getBoundingClientRect()
      c.width = rect.width * dpr
      c.height = rect.height * dpr
      const ctx = c.getContext('2d')!
      ctx.scale(dpr, dpr)
      return { ctx, w: rect.width, h: rect.height }
    }

    let chain = setupCanvas(chainCanvas)
    let wave = setupCanvas(waveCanvas)

    const handleResize = () => {
      chain = setupCanvas(chainCanvas)
      wave = setupCanvas(waveCanvas)
    }
    window.addEventListener('resize', handleResize)

    const physicsStep = (dt: number) => {
      const u = uRef.current
      const uPrev = uPrevRef.current
      const uNext = uNextRef.current
      const c2 = stiffnessRef.current
      const damp = dampingRef.current
      const t = timeRef.current

      // Left boundary: a piston driving the first bead back and forth,
      // or fixed if the drive is off.
      if (driveOnRef.current) {
        u[0] = driveAmpRef.current * Math.sin(2 * Math.PI * driveFreqRef.current * t)
      } else {
        u[0] = 0
      }

      for (let i = 1; i < M - 1; i++) {
        // Newton's second law for bead i, coupled to its neighbors by
        // ideal springs (Hooke's law), F = k(u[i+1]-u[i]) - k(u[i]-u[i-1]):
        //   u_next = 2u - u_prev + c²(u[i+1] - 2u[i] + u[i-1])
        // Same discrete wave equation as the string — the only physical
        // difference is that here u is a displacement ALONG the chain,
        // so a positive u[i+1]-u[i] means bead i+1 has pulled away from
        // bead i (local rarefaction) rather than moved sideways.
        const laplacian = u[i + 1] - 2 * u[i] + u[i - 1]
        uNext[i] = (2 * u[i] - uPrev[i] + c2 * laplacian) * damp
      }

      if (fixedRightEndRef.current) {
        uNext[M - 1] = 0
      } else {
        uNext[M - 1] = uNext[M - 2]
      }
      uNext[0] = u[0]

      uPrevRef.current = u
      uRef.current = uNext
      uNextRef.current = uPrev

      timeRef.current += dt
    }

    const drawChain = () => {
      const colors = colorsRef.current
      if (!colors) return
      const { ctx, w, h } = chain
      const u = uRef.current
      const midY = h * 0.4
      const margin = 24
      const spacing = (w - 2 * margin) / (M - 1)

      ctx.clearRect(0, 0, w, h)

      // Precompute each bead's screen x-position and a local "density"
      // factor: how compressed or stretched the chain is around it,
      // derived from the gradient of displacement (du/dx).
      const posX = new Float32Array(M)
      const density = new Float32Array(M)
      for (let i = 0; i < M; i++) {
        posX[i] = margin + i * spacing + u[i]
      }
      for (let i = 0; i < M; i++) {
        const left = i > 0 ? posX[i - 1] : posX[i] - spacing
        const right = i < M - 1 ? posX[i + 1] : posX[i] + spacing
        const localSpacing = (right - left) / 2
        density[i] = spacing / Math.max(localSpacing, spacing * 0.15)
      }

      // Springs between beads, shaded by local compression.
      ctx.lineWidth = 2
      for (let i = 0; i < M - 1; i++) {
        const d = (density[i] + density[i + 1]) / 2
        const col = lerpColor(colors.rarefied, colors.compressed, clamp01((d - 0.7) / 1.1))
        ctx.strokeStyle = `rgb(${col.r}, ${col.g}, ${col.b})`
        ctx.beginPath()
        ctx.moveTo(posX[i], midY)
        ctx.lineTo(posX[i + 1], midY)
        ctx.stroke()
      }

      // Beads, sized and colored by local density — this is the visual
      // signature of a longitudinal wave: bands of crowded beads
      // (compression) alternating with bands of spread-out beads
      // (rarefaction), traveling down the chain.
      for (let i = 0; i < M; i++) {
        const d = clamp01((density[i] - 0.7) / 1.1)
        const col = lerpColor(colors.rarefied, colors.compressed, d)
        const r = 4 + d * 3
        ctx.beginPath()
        ctx.arc(posX[i], midY, r, 0, Math.PI * 2)
        ctx.fillStyle = `rgb(${col.r}, ${col.g}, ${col.b})`
        ctx.fill()
      }

      // Tracked bead highlighted with a ring, matched to the strip chart.
      ctx.beginPath()
      ctx.arc(posX[TRACKED_INDEX], midY, 8, 0, Math.PI * 2)
      ctx.strokeStyle = colors.tracked
      ctx.lineWidth = 2
      ctx.stroke()

      // Driven end marker.
      if (driveOnRef.current) {
        ctx.beginPath()
        ctx.arc(posX[0], midY, 6, 0, Math.PI * 2)
        ctx.fillStyle = colors.drive
        ctx.fill()
      }

      // Density strip along the bottom: a compact "pressure vs position"
      // readout, the same information sound engineers call a pressure
      // waveform.
      const stripY = h * 0.72
      const stripH = 26
      for (let i = 0; i < M - 1; i++) {
        const d = clamp01((density[i] - 0.7) / 1.1)
        const col = lerpColor(colors.rarefied, colors.compressed, d)
        ctx.fillStyle = `rgb(${col.r}, ${col.g}, ${col.b})`
        ctx.fillRect(posX[i], stripY, posX[i + 1] - posX[i] + 1, stripH)
      }
      ctx.strokeStyle = colors.axis
      ctx.strokeRect(margin, stripY, w - 2 * margin, stripH)

      ctx.fillStyle = colors.text
      ctx.font = '11px var(--font-mono, monospace)'
      ctx.fillText('compression / rarefaction band', margin, stripY + stripH + 16)
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
      const scale = Math.min(1, (h / 2 - 8) / 20)

      ctx.strokeStyle = colors.tracked
      ctx.lineWidth = 2
      ctx.beginPath()
      let started = false
      for (const p of hist) {
        if (p.t < tMin) continue
        const px = ((p.t - tMin) / WINDOW_SECONDS) * w
        const py = midY - p.u * scale
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
      const dt = Math.min((ts - lastTs) / 1000, 0.033)
      lastTs = ts

      if (runningRef.current) {
        physicsStep(dt)
        historyRef.current.push({ t: timeRef.current, u: uRef.current[TRACKED_INDEX] })
        const cutoff = timeRef.current - WINDOW_SECONDS - 1
        while (historyRef.current.length && historyRef.current[0].t < cutoff) {
          historyRef.current.shift()
        }
      }

      drawChain()
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
          <span className="mono">SPECIMEN NO. 04</span>
          <h2>Longitudinal Wave (Ball-Spring Chain)</h2>
        </div>
      </div>

      <div className="sim__body">
        <div className="sim__viewport">
          <div className="sim__panel sim__panel--chain">
            <canvas ref={chainRef} className="sim__canvas" />
          </div>
          <div className="sim__panel sim__panel--wave">
            <div className="sim__wave-legend">
              <span className="mono" style={{ color: 'var(--rust)' }}>
                u(t) — tracked bead's displacement along the chain
              </span>
            </div>
            <canvas ref={waveRef} className="sim__canvas sim__canvas--wave" />
          </div>
        </div>

        <div className="sim__controls">
          <div className="sim__control-group">
            <Dial
              label="Spring stiffness (c²)"
              value={stiffness}
              min={0.05}
              max={0.95}
              step={0.01}
              onChange={setStiffness}
            />
            <Dial
              label="Damping"
              value={damping}
              min={0.99}
              max={1}
              step={0.0005}
              onChange={setDamping}
            />
          </div>

          <div className="sim__control-group">
            <Switch
              label="Continuous drive (left piston)"
              checked={driveOn}
              onChange={setDriveOn}
              swatch="var(--brass-bright)"
            />
            {driveOn && (
              <>
                <Dial
                  label="Drive frequency"
                  value={driveFreq}
                  min={0.1}
                  max={2}
                  step={0.05}
                  unit="Hz"
                  onChange={setDriveFreq}
                />
                <Dial
                  label="Drive amplitude"
                  value={driveAmp}
                  min={2}
                  max={20}
                  step={1}
                  unit="px"
                  onChange={setDriveAmp}
                />
              </>
            )}
            <Switch
              label="Fixed right end"
              checked={fixedRightEnd}
              onChange={setFixedRightEnd}
            />
          </div>

          <div className="sim__buttons">
            <button
              className="sim__btn sim__btn--primary"
              onClick={() => setRunning((r) => !r)}
            >
              {running ? 'Pause' : 'Play'}
            </button>
            <button className="sim__btn" onClick={pushPulse}>
              Push pulse
            </button>
            <button className="sim__btn" onClick={reset}>
              Reset
            </button>
          </div>

          <p className="sim__note">
            Every bead oscillates along the same axis the wave travels —
            that's what makes this longitudinal, unlike the string sim's
            sideways motion. Beads bunch together where{' '}
            <code className="mono">du/dx {'<'} 0</code> (compression, warm
            color) and spread apart where{' '}
            <code className="mono">du/dx {'>'} 0</code> (rarefaction, cool
            color) — exactly how sound moves through air, or a pulse
            travels down a slinky.
          </p>
        </div>
      </div>
    </div>
  )
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function lerpColor(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!m) return null
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  }
}
