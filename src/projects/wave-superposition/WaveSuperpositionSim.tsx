import { useEffect, useRef, useState } from 'react'
import Dial from '../../components/Dial'
import RadioGroup from '../../components/RadioGroup'
import Checkbox from '../../components/Checkbox'
import type { Theme } from '../../lib/useTheme'
import './WaveSuperpositionSim.css'

interface Props {
  theme: Theme
  onBack: () => void
}

interface Colors {
  axis: string
  guide: string
  waveA: string
  waveB: string
  resultant: string
  text: string
}

type WaveShape = 'sine' | 'square' | 'triangle'
type Speed = 'normal' | 'slow'

interface WaveParams {
  shape: WaveShape
  amplitude: number
  wavelength: number
  frequency: number
  phaseDeg: number
}

const SPAN = 4 // spatial units shown across the panel width
const PROBE_X = 0.3
const WINDOW_SECONDS = 6

function waveform(shape: WaveShape, theta: number) {
  switch (shape) {
    case 'square':
      return Math.sign(Math.sin(theta)) || 1
    case 'triangle':
      return (2 / Math.PI) * Math.asin(Math.sin(theta))
    default:
      return Math.sin(theta)
  }
}

function valueAt(p: WaveParams, x: number, t: number) {
  const k = (2 * Math.PI) / p.wavelength
  const omega = 2 * Math.PI * p.frequency
  const phase = (p.phaseDeg * Math.PI) / 180
  return p.amplitude * waveform(p.shape, k * x - omega * t + phase)
}

export default function WaveSuperpositionSim({ theme, onBack }: Props) {
  const spatialRef = useRef<HTMLCanvasElement>(null)
  const probeRef = useRef<HTMLCanvasElement>(null)
  const colorsRef = useRef<Colors | null>(null)
  const timeRef = useRef(0)
  const rafRef = useRef<number>(0)
  const historyRef = useRef<{ t: number; y: number }[]>([])
  const stepRequestRef = useRef(false)

  const [waveA, setWaveA] = useState<WaveParams>({
    shape: 'sine',
    amplitude: 50,
    wavelength: 1.2,
    frequency: 0.5,
    phaseDeg: 0,
  })
  const [waveB, setWaveB] = useState<WaveParams>({
    shape: 'sine',
    amplitude: 50,
    wavelength: 1.2,
    frequency: 0.5,
    phaseDeg: 0,
  })
  const [showA, setShowA] = useState(true)
  const [showB, setShowB] = useState(true)
  const [speed, setSpeed] = useState<Speed>('normal')
  const [running, setRunning] = useState(true)

  const waveARef = useRef(waveA)
  const waveBRef = useRef(waveB)
  const showARef = useRef(showA)
  const showBRef = useRef(showB)
  const speedRef = useRef(speed)
  const runningRef = useRef(running)

  useEffect(() => {
    waveARef.current = waveA
  }, [waveA])
  useEffect(() => {
    waveBRef.current = waveB
  }, [waveB])
  useEffect(() => {
    showARef.current = showA
  }, [showA])
  useEffect(() => {
    showBRef.current = showB
  }, [showB])
  useEffect(() => {
    speedRef.current = speed
  }, [speed])
  useEffect(() => {
    runningRef.current = running
  }, [running])

  useEffect(() => {
    const s = getComputedStyle(document.documentElement)
    const get = (name: string) => s.getPropertyValue(name).trim()
    colorsRef.current = {
      axis: get('--panel-border'),
      guide: get('--text-muted'),
      waveA: get('--teal'),
      waveB: get('--rust'),
      resultant: get('--text'),
      text: get('--text-muted'),
    }
  }, [theme])

  const reset = () => {
    timeRef.current = 0
    historyRef.current = []
  }

  const applyPreset = (preset: 'constructive' | 'destructive' | 'beats') => {
    if (preset === 'constructive') {
      setWaveB((w) => ({ ...w, frequency: waveA.frequency, wavelength: waveA.wavelength, phaseDeg: 0 }))
    } else if (preset === 'destructive') {
      setWaveB((w) => ({ ...w, frequency: waveA.frequency, wavelength: waveA.wavelength, phaseDeg: 180 }))
    } else {
      setWaveB((w) => ({ ...w, wavelength: waveA.wavelength, frequency: waveA.frequency + 0.15, phaseDeg: 0 }))
    }
  }

  useEffect(() => {
    const spatialCanvas = spatialRef.current
    const probeCanvas = probeRef.current
    if (!spatialCanvas || !probeCanvas) return

    const dpr = window.devicePixelRatio || 1
    const setupCanvas = (c: HTMLCanvasElement) => {
      const rect = c.getBoundingClientRect()
      c.width = rect.width * dpr
      c.height = rect.height * dpr
      const ctx = c.getContext('2d')!
      ctx.scale(dpr, dpr)
      return { ctx, w: rect.width, h: rect.height }
    }

    let spatial = setupCanvas(spatialCanvas)
    let probe = setupCanvas(probeCanvas)

    const handleResize = () => {
      spatial = setupCanvas(spatialCanvas)
      probe = setupCanvas(probeCanvas)
    }
    window.addEventListener('resize', handleResize)

    const drawSpatial = () => {
      const colors = colorsRef.current
      if (!colors) return
      const { ctx, w, h } = spatial
      const midY = h / 2
      const t = timeRef.current
      const A = waveARef.current
      const B = waveBRef.current
      const maxAmp = Math.max(A.amplitude, B.amplitude, 1)
      const scale = Math.min(1, (h / 2 - 10) / (A.amplitude + B.amplitude || maxAmp))

      ctx.clearRect(0, 0, w, h)
      ctx.strokeStyle = colors.axis
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.moveTo(0, midY)
      ctx.lineTo(w, midY)
      ctx.stroke()
      ctx.globalAlpha = 1

      const plot = (fn: (x: number) => number, color: string, width: number, dashed: boolean) => {
        ctx.strokeStyle = color
        ctx.lineWidth = width
        if (dashed) ctx.setLineDash([4, 4])
        ctx.beginPath()
        for (let i = 0; i <= 300; i++) {
          const x = (i / 300) * SPAN
          const px = (x / SPAN) * w
          const py = midY - fn(x) * scale
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.stroke()
        ctx.setLineDash([])
      }

      if (showARef.current) plot((x) => valueAt(A, x, t), colors.waveA, 1.5, true)
      if (showBRef.current) plot((x) => valueAt(B, x, t), colors.waveB, 1.5, true)
      plot((x) => valueAt(A, x, t) + valueAt(B, x, t), colors.resultant, 3, false)

      // probe marker
      const probePx = (PROBE_X / SPAN) * w
      ctx.strokeStyle = colors.guide
      ctx.globalAlpha = 0.5
      ctx.setLineDash([2, 4])
      ctx.beginPath()
      ctx.moveTo(probePx, 0)
      ctx.lineTo(probePx, h)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      ctx.font = '10px var(--font-mono, monospace)'
      ctx.fillStyle = colors.text
      ctx.fillText('probe', probePx + 4, 14)
    }

    const drawProbe = () => {
      const colors = colorsRef.current
      if (!colors) return
      const { ctx, w, h } = probe
      const midY = h / 2
      ctx.clearRect(0, 0, w, h)
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
      const A = waveARef.current
      const B = waveBRef.current
      const maxSum = A.amplitude + B.amplitude || 1
      const scale = Math.min(1, (h / 2 - 8) / maxSum)

      ctx.strokeStyle = colors.resultant
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
    const advance = (dt: number) => {
      timeRef.current += dt
      const A = waveARef.current
      const B = waveBRef.current
      const y = valueAt(A, PROBE_X, timeRef.current) + valueAt(B, PROBE_X, timeRef.current)
      historyRef.current.push({ t: timeRef.current, y })
      const cutoff = timeRef.current - WINDOW_SECONDS - 1
      while (historyRef.current.length && historyRef.current[0].t < cutoff) {
        historyRef.current.shift()
      }
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

      drawSpatial()
      drawProbe()
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', handleResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sameFreq = Math.abs(waveA.frequency - waveB.frequency) < 0.005
  const sameWavelength = Math.abs(waveA.wavelength - waveB.wavelength) < 0.01
  let verdict = 'Different wavelengths or frequencies — a shifting interference pattern.'
  if (sameFreq && sameWavelength) {
    const diff = ((waveB.phaseDeg - waveA.phaseDeg) % 360 + 360) % 360
    const distFrom0 = Math.min(diff, 360 - diff)
    const distFrom180 = Math.abs(diff - 180)
    if (distFrom0 < 15) verdict = 'In phase — constructive interference (amplitudes add).'
    else if (distFrom180 < 15) verdict = 'Out of phase by 180° — destructive interference (they cancel).'
    else verdict = `${diff.toFixed(0)}° out of phase — partial interference.`
  } else if (sameWavelength && !sameFreq) {
    verdict = `Slightly different frequencies — listen for beats at |f₁−f₂| ≈ ${Math.abs(waveA.frequency - waveB.frequency).toFixed(2)} Hz.`
  }

  return (
    <div className="sim">
      <div className="sim__header">
        <button className="sim__back" onClick={onBack}>
          ← Cabinet
        </button>
        <div className="sim__plate-label">
          <span className="mono">SPECIMEN NO. 07</span>
          <h2>Superposition of Waves</h2>
        </div>
      </div>

      <div className="sim__body">
        <div className="sim__viewport">
          <div className="sim__panel sim__panel--spatial">
            <canvas ref={spatialRef} className="sim__canvas" />
          </div>
          <div className="sim__panel sim__panel--wave">
            <div className="sim__wave-legend">
              <span className="mono">y(t) at the probe — reveals beats when frequencies differ</span>
            </div>
            <canvas ref={probeRef} className="sim__canvas sim__canvas--wave" />
          </div>
          <div className="sim__verdict">{verdict}</div>
        </div>

        <div className="sim__controls">
          <div className="sim__group-label" style={{ color: 'var(--teal)' }}>
            Wave A
          </div>
          <div className="sim__control-group">
            <Checkbox label="Show" checked={showA} onChange={setShowA} />
            <RadioGroup<WaveShape>
              options={[
                { value: 'sine', label: 'Sine' },
                { value: 'square', label: 'Square' },
                { value: 'triangle', label: 'Triangle' },
              ]}
              value={waveA.shape}
              onChange={(shape) => setWaveA((w) => ({ ...w, shape }))}
            />
            <Dial label="Amplitude" value={waveA.amplitude} min={5} max={90} step={1} onChange={(v) => setWaveA((w) => ({ ...w, amplitude: v }))} />
            <Dial label="Wavelength" value={waveA.wavelength} min={0.3} max={2.5} step={0.05} unit="m" onChange={(v) => setWaveA((w) => ({ ...w, wavelength: v }))} />
            <Dial label="Frequency" value={waveA.frequency} min={0.1} max={1.5} step={0.01} unit="Hz" onChange={(v) => setWaveA((w) => ({ ...w, frequency: v }))} />
            <Dial label="Phase" value={waveA.phaseDeg} min={0} max={360} step={5} unit="°" onChange={(v) => setWaveA((w) => ({ ...w, phaseDeg: v }))} />
          </div>

          <div className="sim__group-label" style={{ color: 'var(--rust)' }}>
            Wave B
          </div>
          <div className="sim__control-group">
            <Checkbox label="Show" checked={showB} onChange={setShowB} />
            <RadioGroup<WaveShape>
              options={[
                { value: 'sine', label: 'Sine' },
                { value: 'square', label: 'Square' },
                { value: 'triangle', label: 'Triangle' },
              ]}
              value={waveB.shape}
              onChange={(shape) => setWaveB((w) => ({ ...w, shape }))}
            />
            <Dial label="Amplitude" value={waveB.amplitude} min={5} max={90} step={1} onChange={(v) => setWaveB((w) => ({ ...w, amplitude: v }))} />
            <Dial label="Wavelength" value={waveB.wavelength} min={0.3} max={2.5} step={0.05} unit="m" onChange={(v) => setWaveB((w) => ({ ...w, wavelength: v }))} />
            <Dial label="Frequency" value={waveB.frequency} min={0.1} max={1.5} step={0.01} unit="Hz" onChange={(v) => setWaveB((w) => ({ ...w, frequency: v }))} />
            <Dial label="Phase" value={waveB.phaseDeg} min={0} max={360} step={5} unit="°" onChange={(v) => setWaveB((w) => ({ ...w, phaseDeg: v }))} />
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
            <button className="sim__btn" onClick={() => applyPreset('constructive')}>
              Constructive
            </button>
            <button className="sim__btn" onClick={() => applyPreset('destructive')}>
              Destructive
            </button>
            <button className="sim__btn" onClick={() => applyPreset('beats')}>
              Beats
            </button>
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
            The resultant (solid, dark) is nothing more than{' '}
            <code className="mono">y = y_A + y_B</code> computed at every
            point — added directly, not a separate formula. Match
            wavelength, frequency, and phase for clean constructive or
            destructive interference; detune the frequency slightly
            instead and watch the probe graph show beats — a slow
            loudness pulsing at exactly the frequency difference between
            the two waves.
          </p>
        </div>
      </div>
    </div>
  )
}
