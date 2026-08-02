import { useEffect, useRef, useState } from 'react'
import Dial from '../../components/Dial'
import Switch from '../../components/Switch'
import type { Theme } from '../../lib/useTheme'

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
}

// Number of discrete mass points along the string. Higher = smoother
// curve, more compute per frame. 220 is comfortably real-time.
const N = 220
const WINDOW_SECONDS = 6

export default function StringWaveSim({ theme, onBack }: Props) {
  const stringRef = useRef<HTMLCanvasElement>(null)
  const waveRef = useRef<HTMLCanvasElement>(null)
  const colorsRef = useRef<Colors | null>(null)

  // y = current displacement, yPrev = displacement one physics step ago.
  // The wave equation is second-order in time, so two time-levels are
  // enough to advance the simulation (no explicit velocity array needed).
  const yRef = useRef<Float32Array>(new Float32Array(N))
  const yPrevRef = useRef<Float32Array>(new Float32Array(N))
  const yNextRef = useRef<Float32Array>(new Float32Array(N))

  const timeRef = useRef(0)
  const historyRef = useRef<{ t: number; y: number }[]>([])
  const rafRef = useRef<number>(0)
  const dragRef = useRef<{ active: boolean; index: number; amp: number } | null>(null)

  const [waveSpeed, setWaveSpeed] = useState(0.5) // Courant number squared, c^2*dt^2/dx^2
  const [damping, setDamping] = useState(0.999)
  const [driveOn, setDriveOn] = useState(false)
  const [driveFreq, setDriveFreq] = useState(0.6)
  const [driveAmp, setDriveAmp] = useState(50)
  const [fixedRightEnd, setFixedRightEnd] = useState(true)
  const [running, setRunning] = useState(true)

  const waveSpeedRef = useRef(waveSpeed)
  const dampingRef = useRef(damping)
  const driveOnRef = useRef(driveOn)
  const driveFreqRef = useRef(driveFreq)
  const driveAmpRef = useRef(driveAmp)
  const fixedRightEndRef = useRef(fixedRightEnd)
  const runningRef = useRef(running)

  useEffect(() => {
    waveSpeedRef.current = waveSpeed
  }, [waveSpeed])
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
    colorsRef.current = {
      axis: get('--panel-border'),
      guide: get('--text-muted'),
      string: get('--text'),
      node: get('--rust'),
      drive: get('--brass-bright'),
      text: get('--text-muted'),
    }
  }, [theme])

  // Raised-cosine pluck: a smooth bump that's zero at its edges, so it
  // blends cleanly into whatever the string is already doing. Centered
  // at grid index `center`, in pixel-space amplitude `amp`.
  const applyPluck = (center: number, amp: number, halfWidth = 30) => {
    const y = yRef.current
    const yPrev = yPrevRef.current
    const lo = Math.max(1, Math.round(center - halfWidth))
    const hi = Math.min(N - 2, Math.round(center + halfWidth))
    for (let i = lo; i <= hi; i++) {
      const frac = (i - center) / halfWidth
      const shape = 0.5 * (1 + Math.cos(Math.PI * Math.min(1, Math.abs(frac))))
      y[i] = amp * shape
      yPrev[i] = y[i] // zero initial velocity — a released pluck, not a push
    }
  }

  const reset = () => {
    yRef.current.fill(0)
    yPrevRef.current.fill(0)
    yNextRef.current.fill(0)
    timeRef.current = 0
    historyRef.current = []
  }

  const pluckCenter = () => {
    applyPluck(N / 2, 90)
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
      const c2 = waveSpeedRef.current
      const damp = dampingRef.current
      const t = timeRef.current

      // Left boundary: either a driven oscillator (a hand shaking the
      // string end) or fixed at zero.
      if (driveOnRef.current) {
        y[0] = driveAmpRef.current * Math.sin(2 * Math.PI * driveFreqRef.current * t)
      } else {
        y[0] = 0
      }

      for (let i = 1; i < N - 1; i++) {
        // 1D wave equation, central-difference discretization:
        //   y_next = 2y - y_prev + c^2 (y[i+1] - 2y[i] + y[i-1])
        // c^2 here is the Courant number (wave-speed-squared * dt^2/dx^2)
        // exposed directly as the "Wave speed" dial. Values above 1 blow
        // up numerically (violates the CFL stability condition), so the
        // dial is capped below that.
        const laplacian = y[i + 1] - 2 * y[i] + y[i - 1]
        yNext[i] = (2 * y[i] - yPrev[i] + c2 * laplacian) * damp
      }

      // Right boundary condition.
      if (fixedRightEndRef.current) {
        yNext[N - 1] = 0 // fixed end: wave inverts on reflection
      } else {
        yNext[N - 1] = yNext[N - 2] // free end: wave reflects upright
      }
      yNext[0] = y[0]

      yPrevRef.current = y
      yRef.current = yNext
      yNextRef.current = yPrev

      timeRef.current += dt
    }

    const drawString = () => {
      const colors = colorsRef.current
      if (!colors) return
      const { ctx, w, h } = strip
      const y = yRef.current
      const midY = h / 2
      const dx = w / (N - 1)

      ctx.clearRect(0, 0, w, h)

      // equilibrium line
      ctx.strokeStyle = colors.axis
      ctx.globalAlpha = 0.4
      ctx.beginPath()
      ctx.moveTo(0, midY)
      ctx.lineTo(w, midY)
      ctx.stroke()
      ctx.globalAlpha = 1

      // the string itself
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

      // driven end marker
      if (driveOnRef.current) {
        ctx.beginPath()
        ctx.arc(0, midY - y[0], 6, 0, Math.PI * 2)
        ctx.fillStyle = colors.drive
        ctx.fill()
      }

      // fixed/free end marker
      ctx.beginPath()
      ctx.arc(w, midY - y[N - 1], 6, 0, Math.PI * 2)
      ctx.fillStyle = fixedRightEndRef.current ? colors.axis : colors.node
      ctx.fill()

      // tracked midpoint node, matched to the strip-chart below
      const mid = Math.floor(N / 2)
      ctx.beginPath()
      ctx.arc(mid * dx, midY - y[mid], 5, 0, Math.PI * 2)
      ctx.fillStyle = colors.node
      ctx.fill()
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
      const dt = Math.min((ts - lastTs) / 1000, 0.033)
      lastTs = ts

      const drag = dragRef.current
      if (drag?.active) {
        // While dragging, freeze the physics and directly sculpt the
        // string shape to follow the pointer — this is what "plucking"
        // feels like interactively.
        applyPluck(drag.index, drag.amp, 30)
      } else if (runningRef.current) {
        physicsStep(dt)
        const mid = Math.floor(N / 2)
        historyRef.current.push({ t: timeRef.current, y: yRef.current[mid] })
        const cutoff = timeRef.current - WINDOW_SECONDS - 1
        while (historyRef.current.length && historyRef.current[0].t < cutoff) {
          historyRef.current.shift()
        }
      }

      drawString()
      drawWave()
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)

    const posToDrag = (clientX: number, clientY: number) => {
      const rect = stringCanvas.getBoundingClientRect()
      const fracX = (clientX - rect.left) / rect.width
      const index = Math.max(1, Math.min(N - 2, fracX * (N - 1)))
      const midY = rect.height / 2
      const amp = midY - (clientY - rect.top)
      return { index, amp: Math.max(-140, Math.min(140, amp)) }
    }

    const onPointerDown = (e: PointerEvent) => {
      const { index, amp } = posToDrag(e.clientX, e.clientY)
      dragRef.current = { active: true, index, amp }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current?.active) return
      const { index, amp } = posToDrag(e.clientX, e.clientY)
      dragRef.current = { active: true, index, amp }
    }
    const onPointerUp = () => {
      if (dragRef.current?.active) {
        // Release: sync yPrev to y at this instant so the string starts
        // from rest, then physics takes over next frame.
        yPrevRef.current.set(yRef.current)
      }
      dragRef.current = null
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
  }, [])

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
          <div className="sim__control-group">
            <Dial
              label="Wave speed (c²)"
              value={waveSpeed}
              min={0.05}
              max={0.95}
              step={0.01}
              onChange={setWaveSpeed}
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
              label="Continuous drive (left end)"
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
                  max={3}
                  step={0.05}
                  unit="Hz"
                  onChange={setDriveFreq}
                />
                <Dial
                  label="Drive amplitude"
                  value={driveAmp}
                  min={5}
                  max={110}
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
            <button className="sim__btn" onClick={pluckCenter}>
              Pluck
            </button>
            <button className="sim__btn" onClick={reset}>
              Reset
            </button>
          </div>

          <p className="sim__note">
            Drag anywhere on the string to pluck it by hand. Each point
            obeys{' '}
            <code className="mono">
              y_next = 2y − y_prev + c²(y[i+1] − 2y[i] + y[i−1])
            </code>
            . With the left end driven and the right end fixed, tune the
            drive frequency until it matches a harmonic — the string
            locks into a standing wave with still nodes and oscillating
            antinodes.
          </p>
        </div>
      </div>
    </div>
  )
}
