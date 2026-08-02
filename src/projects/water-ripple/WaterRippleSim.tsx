import { useEffect, useRef, useState } from 'react'
import Dial from '../../components/Dial'
import RadioGroup from '../../components/RadioGroup'
import Checkbox from '../../components/Checkbox'
import type { Theme } from '../../lib/useTheme'
import './WaterRippleSim.css'

interface Props {
  theme: Theme
  onBack: () => void
}

interface Colors {
  axis: string
  guide: string
  text: string
  waterR: number
  waterG: number
  waterB: number
  air: string
  brass: string
}

type ViewMode = 'top' | 'side'
type Speed = 'normal' | 'slow'

// Grid resolution for the height-field.
const GRID = 110
const FAUCET_GX = 10
const FAUCET_GY = Math.floor(GRID / 2)

export default function WaterRippleSim({ theme, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const profileRef = useRef<HTMLCanvasElement>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const colorsRef = useRef<Colors | null>(null)
  const rafRef = useRef<number>(0)

  const curRef = useRef<Float32Array>(new Float32Array(GRID * GRID))
  const prevRef = useRef<Float32Array>(new Float32Array(GRID * GRID))
  const nextRef = useRef<Float32Array>(new Float32Array(GRID * GRID))

  const autoTimerRef = useRef(0)
  const frameSkipRef = useRef(0)
  const timeRef = useRef(0)
  const historyRef = useRef<{ t: number; h: number }[]>([])

  const [damping, setDamping] = useState(0.992)
  const [faucetOn, setFaucetOn] = useState(true)
  const [faucetFreq, setFaucetFreq] = useState(0.8)
  const [faucetAmp, setFaucetAmp] = useState(2.2)
  const [dropletRadius] = useState(4)
  const [viewMode, setViewMode] = useState<ViewMode>('top')
  const [speed, setSpeed] = useState<Speed>('normal')
  const [showGraph, setShowGraph] = useState(true)
  const [showScale, setShowScale] = useState(true)

  const dampingRef = useRef(damping)
  const faucetOnRef = useRef(faucetOn)
  const faucetFreqRef = useRef(faucetFreq)
  const faucetAmpRef = useRef(faucetAmp)
  const dropletRadiusRef = useRef(dropletRadius)
  const viewModeRef = useRef(viewMode)
  const speedRef = useRef(speed)

  useEffect(() => {
    dampingRef.current = damping
  }, [damping])
  useEffect(() => {
    faucetOnRef.current = faucetOn
  }, [faucetOn])
  useEffect(() => {
    faucetFreqRef.current = faucetFreq
  }, [faucetFreq])
  useEffect(() => {
    faucetAmpRef.current = faucetAmp
  }, [faucetAmp])
  useEffect(() => {
    dropletRadiusRef.current = dropletRadius
  }, [dropletRadius])
  useEffect(() => {
    viewModeRef.current = viewMode
  }, [viewMode])
  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  useEffect(() => {
    const s = getComputedStyle(document.documentElement)
    const get = (name: string) => s.getPropertyValue(name).trim()
    const teal = get('--teal') || '#2f6f62'
    const rgb = hexToRgb(teal) ?? { r: 47, g: 111, b: 98 }
    colorsRef.current = {
      axis: get('--panel-border'),
      guide: get('--text-muted'),
      text: get('--text-muted'),
      waterR: rgb.r,
      waterG: rgb.g,
      waterB: rgb.b,
      air: get('--panel'),
      brass: get('--brass'),
    }
  }, [theme])

  const addDroplet = (gx: number, gy: number, strength: number, radius: number) => {
    const cur = curRef.current
    const prev = prevRef.current
    const r2 = radius * radius
    const minX = Math.max(1, Math.floor(gx - radius))
    const maxX = Math.min(GRID - 2, Math.ceil(gx + radius))
    const minY = Math.max(1, Math.floor(gy - radius))
    const maxY = Math.min(GRID - 2, Math.ceil(gy + radius))
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - gx
        const dy = y - gy
        const d2 = dx * dx + dy * dy
        if (d2 > r2 * 3) continue
        const bump = strength * Math.exp(-d2 / (2 * r2))
        cur[y * GRID + x] -= bump
        prev[y * GRID + x] -= bump
      }
    }
  }

  const reset = () => {
    curRef.current.fill(0)
    prevRef.current.fill(0)
    nextRef.current.fill(0)
    historyRef.current = []
    timeRef.current = 0
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const profileCanvas = profileRef.current
    if (!canvas || !profileCanvas) return

    const dpr = window.devicePixelRatio || 1
    const setupCanvas = (c: HTMLCanvasElement) => {
      const rect = c.getBoundingClientRect()
      c.width = rect.width * dpr
      c.height = rect.height * dpr
      const ctx = c.getContext('2d')!
      ctx.scale(dpr, dpr)
      return { ctx, w: rect.width, h: rect.height }
    }

    let main = setupCanvas(canvas)
    let profile = setupCanvas(profileCanvas)

    const handleResize = () => {
      main = setupCanvas(canvas)
      profile = setupCanvas(profileCanvas)
    }
    window.addEventListener('resize', handleResize)

    const offscreen = document.createElement('canvas')
    offscreen.width = GRID
    offscreen.height = GRID
    offscreenRef.current = offscreen
    const offCtx = offscreen.getContext('2d')!
    const imgData = offCtx.createImageData(GRID, GRID)

    const lightDir = normalize3(0.45, -0.55, 0.7)

    const physicsStep = () => {
      const cur = curRef.current
      const prev = prevRef.current
      const next = nextRef.current
      const damp = dampingRef.current

      for (let y = 1; y < GRID - 1; y++) {
        const row = y * GRID
        const rowUp = row - GRID
        const rowDown = row + GRID
        for (let x = 1; x < GRID - 1; x++) {
          const neighborSum =
            cur[rowUp + x] + cur[rowDown + x] + cur[row + x - 1] + cur[row + x + 1]
          next[row + x] = ((neighborSum / 2) - prev[row + x]) * damp
        }
      }
      prevRef.current = cur
      curRef.current = next
      nextRef.current = prev
    }

    const renderTop = () => {
      const colors = colorsRef.current
      if (!colors) return
      const cur = curRef.current
      const data = imgData.data
      const { waterR, waterG, waterB } = colors

      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const i = y * GRID + x
          const xL = x > 0 ? i - 1 : i
          const xR = x < GRID - 1 ? i + 1 : i
          const yU = y > 0 ? i - GRID : i
          const yD = y < GRID - 1 ? i + GRID : i
          const dHdx = (cur[xR] - cur[xL]) * 6
          const dHdy = (cur[yD] - cur[yU]) * 6
          const n = normalize3(-dHdx, -dHdy, 1)

          const diffuse = Math.max(0, n.x * lightDir.x + n.y * lightDir.y + n.z * lightDir.z)
          const halfZ = (lightDir.z + 1) / Math.hypot(lightDir.x, lightDir.y, lightDir.z + 1)
          const specular = Math.pow(Math.max(0, n.z * halfZ), 28)

          const shade = 0.45 + 0.55 * diffuse
          const p = i * 4
          data[p] = clamp255(waterR * shade + 255 * specular)
          data[p + 1] = clamp255(waterG * shade + 255 * specular)
          data[p + 2] = clamp255(waterB * shade + 255 * specular * 0.9 + 20)
          data[p + 3] = 255
        }
      }
      offCtx.putImageData(imgData, 0, 0)

      main.ctx.imageSmoothingEnabled = true
      main.ctx.clearRect(0, 0, main.w, main.h)
      main.ctx.drawImage(offscreen, 0, 0, GRID, GRID, 0, 0, main.w, main.h)
      main.ctx.strokeStyle = colors.axis
      main.ctx.lineWidth = 1
      main.ctx.strokeRect(0.5, 0.5, main.w - 1, main.h - 1)

      drawFaucet(main.ctx, (FAUCET_GX / GRID) * main.w, (FAUCET_GY / GRID) * main.h, colors, true)

      if (showScale) {
        drawScaleBar(main.ctx, main.w, main.h, colors)
      }
    }

    const renderSide = () => {
      const colors = colorsRef.current
      if (!colors) return
      const cur = curRef.current
      const { ctx, w, h } = main
      ctx.clearRect(0, 0, w, h)

      const baseline = h * 0.45
      const scale = h * 3.2

      // air above the waterline
      ctx.fillStyle = colors.air
      ctx.fillRect(0, 0, w, baseline)

      // water body: filled polygon following the height profile through
      // the faucet's row, exactly like a real side-on cross-section.
      ctx.beginPath()
      ctx.moveTo(0, baseline - cur[FAUCET_GY * GRID] * scale)
      for (let x = 0; x < GRID; x++) {
        const px = (x / (GRID - 1)) * w
        const py = baseline - cur[FAUCET_GY * GRID + x] * scale
        ctx.lineTo(px, py)
      }
      ctx.lineTo(w, h)
      ctx.lineTo(0, h)
      ctx.closePath()
      ctx.fillStyle = `rgb(${colors.waterR}, ${colors.waterG}, ${colors.waterB})`
      ctx.fill()

      // bright surface line to sell the "water line" read
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let x = 0; x < GRID; x++) {
        const px = (x / (GRID - 1)) * w
        const py = baseline - cur[FAUCET_GY * GRID + x] * scale
        if (x === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()

      ctx.strokeStyle = colors.axis
      ctx.globalAlpha = 0.4
      ctx.setLineDash([4, 5])
      ctx.beginPath()
      ctx.moveTo(0, baseline)
      ctx.lineTo(w, baseline)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1)

      drawFaucet(ctx, (FAUCET_GX / GRID) * w, baseline - cur[FAUCET_GY * GRID + FAUCET_GX] * scale, colors, false)

      if (showScale) {
        drawScaleBar(ctx, w, h, colors)
      }
    }

    const drawFaucet = (
      ctx: CanvasRenderingContext2D,
      px: number,
      py: number,
      colors: Colors,
      topView: boolean,
    ) => {
      ctx.save()
      ctx.translate(px, py)
      // pipe entering from the left edge
      ctx.strokeStyle = colors.brass
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(-40, 0)
      ctx.lineTo(-6, 0)
      ctx.stroke()
      // valve knob — glows when the faucet is actively driving
      ctx.beginPath()
      ctx.arc(-6, 0, 6, 0, Math.PI * 2)
      ctx.fillStyle = faucetOnRef.current ? '#ffd27a' : colors.brass
      ctx.fill()
      if (!topView) {
        ctx.strokeStyle = colors.axis
        ctx.lineWidth = 1
        ctx.stroke()
      }
      ctx.restore()
    }

    const drawScaleBar = (ctx: CanvasRenderingContext2D, w: number, h: number, colors: Colors) => {
      const barW = w * 0.15
      const x0 = w - barW - 14
      const y0 = h - 16
      ctx.strokeStyle = colors.text
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x0 + barW, y0)
      ctx.moveTo(x0, y0 - 4)
      ctx.lineTo(x0, y0 + 4)
      ctx.moveTo(x0 + barW, y0 - 4)
      ctx.lineTo(x0 + barW, y0 + 4)
      ctx.stroke()
      ctx.font = '10px var(--font-mono, monospace)'
      ctx.fillStyle = colors.text
      ctx.fillText('scale', x0, y0 - 8)
    }

    const renderGraph = () => {
      const colors = colorsRef.current
      if (!colors || !showGraph) {
        profile.ctx.clearRect(0, 0, profile.w, profile.h)
        return
      }
      const { ctx, w, h } = profile
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
      const WINDOW = 6
      const tMin = tNow - WINDOW
      const scale = Math.min(1, (h / 2 - 8) / 6)

      ctx.strokeStyle = colors.text
      ctx.lineWidth = 2
      ctx.beginPath()
      let started = false
      for (const p of hist) {
        if (p.t < tMin) continue
        const px = ((p.t - tMin) / WINDOW) * w
        const py = midY - p.h * scale
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
      const dt = (ts - lastTs) / 1000
      lastTs = ts

      // "Slow" runs physics on every 3rd frame instead of scaling dt,
      // since the grid update is a discrete iteration, not a
      // continuous integrator.
      frameSkipRef.current++
      const shouldStep = speedRef.current === 'normal' || frameSkipRef.current % 3 === 0

      if (shouldStep) {
        if (faucetOnRef.current) {
          autoTimerRef.current += dt
          const interval = 1 / faucetFreqRef.current
          if (autoTimerRef.current >= interval) {
            autoTimerRef.current = 0
            addDroplet(FAUCET_GX, FAUCET_GY, faucetAmpRef.current, dropletRadiusRef.current)
          }
        }
        physicsStep()
        timeRef.current += dt
        historyRef.current.push({ t: timeRef.current, h: curRef.current[FAUCET_GY * GRID + Math.floor(GRID * 0.7)] })
        const cutoff = timeRef.current - 7
        while (historyRef.current.length && historyRef.current[0].t < cutoff) {
          historyRef.current.shift()
        }
      }

      if (viewModeRef.current === 'top') renderTop()
      else renderSide()
      renderGraph()
      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)

    const handlePointerDown = (e: PointerEvent) => {
      if (viewModeRef.current !== 'top') return
      const rect = canvas.getBoundingClientRect()
      const px = (e.clientX - rect.left) / rect.width
      const py = (e.clientY - rect.top) / rect.height
      addDroplet(px * GRID, py * GRID, 2.2, dropletRadiusRef.current)
    }
    canvas.addEventListener('pointerdown', handlePointerDown)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', handleResize)
      canvas.removeEventListener('pointerdown', handlePointerDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGraph, showScale])

  return (
    <div className="sim">
      <div className="sim__header">
        <button className="sim__back" onClick={onBack}>
          ← Cabinet
        </button>
        <div className="sim__plate-label">
          <span className="mono">SPECIMEN NO. 02</span>
          <h2>Water Droplet Ripple</h2>
        </div>
      </div>

      <div className="sim__body">
        <div className="sim__viewport">
          <div className="sim__panel sim__panel--pond">
            <canvas ref={canvasRef} className="sim__canvas" />
          </div>
          <div className="sim__panel sim__panel--wave">
            <div className="sim__wave-legend">
              <span className="mono">h(t) — probe point, 70% across the pond</span>
            </div>
            <canvas ref={profileRef} className="sim__canvas sim__canvas--wave" />
          </div>
        </div>

        <div className="sim__controls">
          <div className="sim__control-group">
            <RadioGroup<ViewMode>
              legend="View"
              options={[
                { value: 'top', label: 'Top View' },
                { value: 'side', label: 'Side View' },
              ]}
              value={viewMode}
              onChange={setViewMode}
            />
          </div>

          <div className="sim__control-group">
            <Checkbox label="Faucet drips" checked={faucetOn} onChange={setFaucetOn} />
            {faucetOn && (
              <>
                <Dial
                  label="Frequency"
                  value={faucetFreq}
                  min={0.1}
                  max={3}
                  step={0.05}
                  unit="Hz"
                  onChange={setFaucetFreq}
                />
                <Dial
                  label="Amplitude"
                  value={faucetAmp}
                  min={0.5}
                  max={5}
                  step={0.1}
                  onChange={setFaucetAmp}
                />
              </>
            )}
            <Dial
              label="Damping"
              value={damping}
              min={0.95}
              max={0.999}
              step={0.001}
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

          <div className="sim__control-group">
            <Checkbox label="Graph" checked={showGraph} onChange={setShowGraph} />
            <Checkbox label="Scale bar" checked={showScale} onChange={setShowScale} />
          </div>

          <div className="sim__buttons">
            <button className="sim__btn sim__btn--primary" onClick={reset}>
              Clear pond
            </button>
          </div>

          <p className="sim__note">
            In <strong>Top View</strong> you can still click anywhere to
            drop water by hand, on top of the faucet's steady drips.{' '}
            <strong>Side View</strong> cuts a cross-section right through
            the faucet's row, so you can watch the same 2D wave equation
            (<code className="mono">h ← (Σ neighbors)/2 − h_prev</code>)
            you saw from above, now as a proper water-level profile.
          </p>
        </div>
      </div>
    </div>
  )
}

function normalize3(x: number, y: number, z: number) {
  const len = Math.hypot(x, y, z) || 1
  return { x: x / len, y: y / len, z: z / len }
}

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
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
