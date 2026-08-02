import { useEffect, useRef, useState } from 'react'
import Dial from '../../components/Dial'
import RadioGroup from '../../components/RadioGroup'
import Checkbox from '../../components/Checkbox'
import type { Theme } from '../../lib/useTheme'
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
  speaker: string
  speakerOn: string
  tracked: string
  text: string
}

type Speed = 'normal' | 'slow'

// Carrier field: a 1D wave equation solved along x, sampled by however
// many molecules the density dial asks for. Decoupling the physics
// resolution from the molecule count means turning "Molecules" up or
// down never changes the wave's behavior, only how densely it's drawn.
const CN = 170
const ABSORB_ZONE = 0.2
const TRACK_FRAC = 0.42

export default function LongitudinalWaveSim({ theme, onBack }: Props) {
  const chainRef = useRef<HTMLCanvasElement>(null)
  const waveRef = useRef<HTMLCanvasElement>(null)
  const colorsRef = useRef<Colors | null>(null)

  const uRef = useRef<Float32Array>(new Float32Array(CN))
  const uPrevRef = useRef<Float32Array>(new Float32Array(CN))
  const uNextRef = useRef<Float32Array>(new Float32Array(CN))

  const timeRef = useRef(0)
  const historyRef = useRef<{ t: number; u: number }[]>([])
  const rafRef = useRef<number>(0)

  const [stiffness, setStiffness] = useState(0.55)
  const [damping, setDamping] = useState(0.999)
  const [speakerOn, setSpeakerOn] = useState(true)
  const [frequency, setFrequency] = useState(0.6)
  const [intensity, setIntensity] = useState(12)
  const [density, setDensity] = useState(12) // rows of molecules
  const [speed, setSpeed] = useState<Speed>('normal')
  const [running, setRunning] = useState(true)

  const stiffnessRef = useRef(stiffness)
  const dampingRef = useRef(damping)
  const speakerOnRef = useRef(speakerOn)
  const frequencyRef = useRef(frequency)
  const intensityRef = useRef(intensity)
  const densityRef = useRef(density)
  const speedRef = useRef(speed)
  const runningRef = useRef(running)

  useEffect(() => {
    stiffnessRef.current = stiffness
  }, [stiffness])
  useEffect(() => {
    dampingRef.current = damping
  }, [damping])
  useEffect(() => {
    speakerOnRef.current = speakerOn
  }, [speakerOn])
  useEffect(() => {
    frequencyRef.current = frequency
  }, [frequency])
  useEffect(() => {
    intensityRef.current = intensity
  }, [intensity])
  useEffect(() => {
    densityRef.current = density
  }, [density])
  useEffect(() => {
    speedRef.current = speed
  }, [speed])
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
      compressed: rust,
      rarefied: teal,
      speaker: get('--brass'),
      speakerOn: '#ffd27a',
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

  const pushPulse = () => {
    const u = uRef.current
    const uPrev = uPrevRef.current
    const halfWidth = 8
    for (let i = CN - 1 - halfWidth * 2; i < CN - 1; i++) {
      if (i < 1) continue
      const center = CN - 1 - halfWidth
      const frac = (i - center) / halfWidth
      const shape = 0.5 * (1 + Math.cos(Math.PI * Math.min(1, Math.abs(frac))))
      u[i] = -14 * shape // pulled inward, like a single push of the cone
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

    // Absorbing zone at the FAR (left) end from the speaker, so sound
    // fades into open air instead of bouncing back as an echo.
    const absorbProfile = new Float32Array(CN)
    const absorbEnd = Math.floor(CN * ABSORB_ZONE)
    for (let i = 0; i < CN; i++) {
      if (i > absorbEnd) {
        absorbProfile[i] = 1
      } else {
        const frac = 1 - i / absorbEnd
        absorbProfile[i] = 1 - frac * 0.6
      }
    }

    const physicsStep = (dt: number) => {
      const u = uRef.current
      const uPrev = uPrevRef.current
      const uNext = uNextRef.current
      const c2 = stiffnessRef.current
      const damp = dampingRef.current
      const t = timeRef.current

      // Right boundary (index CN-1) is the speaker cone itself.
      if (speakerOnRef.current) {
        u[CN - 1] = intensityRef.current * Math.sin(2 * Math.PI * frequencyRef.current * t)
      }

      for (let i = 1; i < CN - 1; i++) {
        const laplacian = u[i + 1] - 2 * u[i] + u[i - 1]
        uNext[i] = (2 * u[i] - uPrev[i] + c2 * laplacian) * damp * absorbProfile[i]
      }
      uNext[0] = uNext[1]
      uNext[CN - 1] = u[CN - 1]

      uPrevRef.current = u
      uRef.current = uNext
      uNextRef.current = uPrev

      timeRef.current += dt
    }

    const drawSpeaker = (ctx: CanvasRenderingContext2D, x: number, y: number, coneOffset: number, colors: Colors) => {
      ctx.save()
      ctx.translate(x, y)
      // cabinet
      ctx.fillStyle = colors.axis
      ctx.fillRect(0, -55, 34, 110)
      // cone, its depth animated by the driven displacement
      const coneX = -coneOffset * 0.6
      ctx.beginPath()
      ctx.arc(coneX, 0, 30, -Math.PI / 2.3, Math.PI / 2.3)
      ctx.fillStyle = speakerOnRef.current ? colors.speakerOn : colors.speaker
      ctx.fill()
      ctx.strokeStyle = colors.axis
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()
    }

    const drawChain = () => {
      const colors = colorsRef.current
      if (!colors) return
      const { ctx, w, h } = chain
      const u = uRef.current
      const midY = h * 0.42
      const marginL = 20
      const marginR = 70 // room for the speaker cabinet
      const usableW = w - marginL - marginR

      const rows = Math.round(densityRef.current)
      const cols = Math.max(10, Math.round(rows * 2.4))
      const colSpacing = usableW / (cols - 1)
      const rowSpacing = Math.min(16, (h * 0.5) / rows)
      const gridTop = midY - (rows * rowSpacing) / 2

      ctx.clearRect(0, 0, w, h)

      // Sample the carrier field once per column, not per molecule —
      // every bead in a column shares the same longitudinal offset,
      // which is physically correct (a sound wave doesn't care about
      // your height) and far cheaper to compute.
      const colDx = new Float32Array(cols)
      const colDensity = new Float32Array(cols)
      for (let c = 0; c < cols; c++) {
        const ex = marginL + c * colSpacing
        const frac = ex / (marginL + usableW)
        const idx = Math.max(1, Math.min(CN - 2, Math.round(frac * (CN - 1))))
        colDx[c] = u[idx] * 0.9
        const grad = u[idx + 1] - u[idx - 1]
        colDensity[c] = clamp01(0.5 - grad * 3)
      }

      for (let c = 0; c < cols; c++) {
        const ex = marginL + c * colSpacing + colDx[c]
        const col = lerpColor(colors.rarefied, colors.compressed, colDensity[c])
        const r = 2.6 + colDensity[c] * 2
        for (let rIdx = 0; rIdx < rows; rIdx++) {
          const ey = gridTop + rIdx * rowSpacing
          ctx.beginPath()
          ctx.arc(ex, ey, r, 0, Math.PI * 2)
          ctx.fillStyle = `rgb(${col.r}, ${col.g}, ${col.b})`
          ctx.fill()
        }
      }

      // tracked column ring, matched to the strip chart
      const trackIdx = Math.round(TRACK_FRAC * (cols - 1))
      const trackEx = marginL + trackIdx * colSpacing + colDx[trackIdx]
      ctx.beginPath()
      ctx.arc(trackEx, gridTop - 10, 7, 0, Math.PI * 2)
      ctx.strokeStyle = colors.tracked
      ctx.lineWidth = 2
      ctx.stroke()

      // density strip along the bottom
      const stripY = h - 34
      const stripH = 20
      for (let c = 0; c < cols - 1; c++) {
        const x0 = marginL + c * colSpacing + colDx[c]
        const x1 = marginL + (c + 1) * colSpacing + colDx[c + 1]
        const col = lerpColor(colors.rarefied, colors.compressed, colDensity[c])
        ctx.fillStyle = `rgb(${col.r}, ${col.g}, ${col.b})`
        ctx.fillRect(x0, stripY, x1 - x0 + 1, stripH)
      }
      ctx.strokeStyle = colors.axis
      ctx.strokeRect(marginL, stripY, usableW, stripH)
      ctx.font = '11px var(--font-mono, monospace)'
      ctx.fillStyle = colors.text
      ctx.fillText('compression / rarefaction band', marginL, stripY + stripH + 16)

      drawSpeaker(ctx, w - marginR + 18, midY, u[CN - 1] * 0.9, colors)
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
      const scale = Math.min(1, (h / 2 - 8) / 20)

      ctx.strokeStyle = colors.tracked
      ctx.lineWidth = 2
      ctx.beginPath()
      let started = false
      for (const p of hist) {
        if (p.t < tMin) continue
        const px = ((p.t - tMin) / WINDOW) * w
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
      const rawDt = Math.min((ts - lastTs) / 1000, 0.033)
      const dt = speedRef.current === 'slow' ? rawDt * 0.3 : rawDt
      lastTs = ts

      if (runningRef.current) {
        physicsStep(dt)
        const trackIdx = Math.round(TRACK_FRAC * (CN - 1))
        historyRef.current.push({ t: timeRef.current, u: uRef.current[trackIdx] })
        const cutoff = timeRef.current - 7
        while (historyRef.current.length && historyRef.current[0].t < cutoff) {
          historyRef.current.shift()
        }
      }

      drawChain()
      drawWave()
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)

    const handlePointerDown = (e: PointerEvent) => {
      const rect = chainCanvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      // speaker cabinet occupies roughly the last 70px of the panel
      if (px > rect.width - 75) {
        setSpeakerOn((on) => !on)
      }
    }
    chainCanvas.addEventListener('pointerdown', handlePointerDown)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', handleResize)
      chainCanvas.removeEventListener('pointerdown', handlePointerDown)
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
          <h2>Longitudinal Wave — Speaker &amp; Air</h2>
        </div>
      </div>

      <div className="sim__body">
        <div className="sim__viewport">
          <div className="sim__panel sim__panel--chain">
            <canvas ref={chainRef} className="sim__canvas sim__canvas--speaker" />
          </div>
          <div className="sim__panel sim__panel--wave">
            <div className="sim__wave-legend">
              <span className="mono" style={{ color: 'var(--rust)' }}>
                u(t) — tracked molecule's displacement
              </span>
            </div>
            <canvas ref={waveRef} className="sim__canvas sim__canvas--wave" />
          </div>
        </div>

        <div className="sim__controls">
          <div className="sim__control-group">
            <Checkbox label="Speaker on (or click the cone)" checked={speakerOn} onChange={setSpeakerOn} />
            {speakerOn && (
              <>
                <Dial
                  label="Frequency (pitch)"
                  value={frequency}
                  min={0.1}
                  max={2.5}
                  step={0.05}
                  unit="Hz"
                  onChange={setFrequency}
                />
                <Dial
                  label="Intensity (loudness)"
                  value={intensity}
                  min={1}
                  max={25}
                  step={1}
                  unit="px"
                  onChange={setIntensity}
                />
              </>
            )}
            <Dial
              label="Molecules"
              value={density}
              min={6}
              max={20}
              step={1}
              onChange={setDensity}
            />
          </div>

          <div className="sim__control-group">
            <Dial
              label="Wave speed (c²)"
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
            <button
              className="sim__btn sim__btn--primary"
              onClick={() => setRunning((r) => !r)}
            >
              {running ? 'Pause' : 'Play'}
            </button>
            <button className="sim__btn" onClick={pushPulse}>
              Single push
            </button>
            <button className="sim__btn" onClick={reset}>
              Reset
            </button>
          </div>

          <p className="sim__note">
            Click the speaker cone (or the checkbox) to start it
            vibrating. Every molecule shifts <em>along the same axis</em>{' '}
            the wave travels — left-right, never up-down — which is what
            makes this longitudinal rather than transverse. Turn up
            "Intensity" for louder compressions or "Molecules" for a
            denser medium (sound needs a medium — this is why sound
            can't travel through a vacuum).
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
