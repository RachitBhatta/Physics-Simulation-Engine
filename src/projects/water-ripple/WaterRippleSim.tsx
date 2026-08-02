import { useEffect, useRef, useState } from 'react'
import Dial from '../../components/Dial'
import Switch from '../../components/Switch'
import type { Theme } from '../../lib/useTheme'
// @ts-ignore: CSS import type declarations are not available in this project setup.
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
}

// Grid resolution for the height-field. Kept modest (110x110 = 12.1k cells)
// because every cell is touched twice per frame: once for the physics
// update, once for the per-pixel lighting pass.
const GRID = 110

export default function WaterRippleSim({ theme, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const profileRef = useRef<HTMLCanvasElement>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const colorsRef = useRef<Colors | null>(null)
  const rafRef = useRef<number>(0)

  // Two height buffers (current + previous step) implement the discrete
  // 2D wave equation. A third scratch buffer holds the "next" frame while
  // it's being computed, then buffers are rotated.
  const curRef = useRef<Float32Array>(new Float32Array(GRID * GRID))
  const prevRef = useRef<Float32Array>(new Float32Array(GRID * GRID))
  const nextRef = useRef<Float32Array>(new Float32Array(GRID * GRID))

  const lastDropRowRef = useRef(Math.floor(GRID / 2))
  const autoTimerRef = useRef(0)

  const [damping, setDamping] = useState(0.992)
  const [dropletRadius, setDropletRadius] = useState(4)
  const [dropletStrength, setDropletStrength] = useState(2.2)
  const [autoDrip, setAutoDrip] = useState(false)
  const [dripInterval, setDripInterval] = useState(1.2)
  const [showProfile, setShowProfile] = useState(true)

  const dampingRef = useRef(damping)
  const dropletRadiusRef = useRef(dropletRadius)
  const dropletStrengthRef = useRef(dropletStrength)
  const autoDripRef = useRef(autoDrip)
  const dripIntervalRef = useRef(dripInterval)
  const showProfileRef = useRef(showProfile)

  useEffect(() => {
    dampingRef.current = damping
  }, [damping])
  useEffect(() => {
    dropletRadiusRef.current = dropletRadius
  }, [dropletRadius])
  useEffect(() => {
    dropletStrengthRef.current = dropletStrength
  }, [dropletStrength])
  useEffect(() => {
    autoDripRef.current = autoDrip
  }, [autoDrip])
  useEffect(() => {
    dripIntervalRef.current = dripInterval
  }, [dripInterval])
  useEffect(() => {
    showProfileRef.current = showProfile
  }, [showProfile])

  useEffect(() => {
    const s = getComputedStyle(document.documentElement)
    const get = (name: string) => s.getPropertyValue(name).trim()
    // Parse the theme's teal accent into RGB so the water tint stays
    // consistent with the rest of the cabinet, independent of oak/walnut.
    const teal = get('--teal') || '#2f6f62'
    const rgb = hexToRgb(teal) ?? { r: 47, g: 111, b: 98 }
    colorsRef.current = {
      axis: get('--panel-border'),
      guide: get('--text-muted'),
      text: get('--text-muted'),
      waterR: rgb.r,
      waterG: rgb.g,
      waterB: rgb.b,
    }
  }, [theme])

  // Add a Gaussian-shaped depression to the height field, centered at grid
  // cell (gx, gy). Physically this models the momentary displacement a
  // falling droplet causes on impact; the wave equation then propagates
  // that disturbance outward as a ring — exactly what you see when a drop
  // hits still water viewed from above.
  const addDroplet = (gx: number, gy: number) => {
    const cur = curRef.current
    const prev = prevRef.current
    const r = dropletRadiusRef.current
    const strength = dropletStrengthRef.current
    const r2 = r * r
    const minX = Math.max(1, Math.floor(gx - r))
    const maxX = Math.min(GRID - 2, Math.ceil(gx + r))
    const minY = Math.max(1, Math.floor(gy - r))
    const maxY = Math.min(GRID - 2, Math.ceil(gy + r))
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
    lastDropRowRef.current = Math.round(gy)
  }

  const reset = () => {
    curRef.current.fill(0)
    prevRef.current.fill(0)
    nextRef.current.fill(0)
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

    // Offscreen low-res canvas: we render one pixel per grid cell here,
    // then let the browser upscale it with smoothing onto the visible
    // canvas. This is far cheaper than shading at display resolution and
    // gives a naturally soft, water-like blur for free.
    const offscreen = document.createElement('canvas')
    offscreen.width = GRID
    offscreen.height = GRID
    offscreenRef.current = offscreen
    const offCtx = offscreen.getContext('2d')!
    const imgData = offCtx.createImageData(GRID, GRID)

    // Seed a droplet in the center so the pond isn't dead on load.
    addDroplet(GRID / 2, GRID / 2)

    // Fixed light direction (from upper-left, like sunlight on a pond),
    // used for Lambertian shading of the height field's surface normal.
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
          // Discrete 2D wave equation (the classic "ripple tank" update):
          // each cell's next height is driven toward the average of its
          // four neighbors, minus its own height one step ago. This is
          // equivalent to a finite-difference solution of
          //   d^2z/dt^2 = c^2 * (d^2z/dx^2 + d^2z/dy^2)
          // with c and dt folded into the coefficients, then damped so
          // energy dissipates instead of ringing forever.
          const neighborSum =
            cur[rowUp + x] + cur[rowDown + x] + cur[row + x - 1] + cur[row + x + 1]
          const h = (neighborSum / 2 - prev[row + x]) * damp
          next[row + x] = h
        }
      }
      // Rotate buffers: prev <- cur, cur <- next (reuse old prev array as
      // the new scratch buffer to avoid allocating every frame).
      prevRef.current = cur
      curRef.current = next
      nextRef.current = prev
    }

    const renderWater = () => {
      const colors = colorsRef.current
      if (!colors) return
      const cur = curRef.current
      const data = imgData.data
      const { waterR, waterG, waterB } = colors

      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const i = y * GRID + x
          // Surface normal from the height field's local slope (central
          // difference). Clamped indices avoid reading out of bounds at
          // the pond's edge.
          const xL = x > 0 ? i - 1 : i
          const xR = x < GRID - 1 ? i + 1 : i
          const yU = y > 0 ? i - GRID : i
          const yD = y < GRID - 1 ? i + GRID : i
          const dHdx = (cur[xR] - cur[xL]) * 6
          const dHdy = (cur[yD] - cur[yU]) * 6
          const n = normalize3(-dHdx, -dHdy, 1)

          const diffuse = Math.max(0, n.x * lightDir.x + n.y * lightDir.y + n.z * lightDir.z)
          // Blinn-Phong-style specular highlight so wave crests catch a
          // bright glint, the way real water does.
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

      // Thin frame so the pond reads as a contained vessel, not a void.
      main.ctx.strokeStyle = colors.axis
      main.ctx.lineWidth = 1
      main.ctx.strokeRect(0.5, 0.5, main.w - 1, main.h - 1)
    }

    const renderProfile = () => {
      const colors = colorsRef.current
      if (!colors || !showProfileRef.current) {
        profile.ctx.clearRect(0, 0, profile.w, profile.h)
        return
      }
      const cur = curRef.current
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

      // Plot the height field along the row of the most recent drop —
      // a 1D cross-section through the 2D ripple, so you can directly
      // see the wave profile (crest/trough spacing) that the top-down
      // view only shows as light and shadow.
      const row = lastDropRowRef.current
      const scale = h * 6
      ctx.strokeStyle = colors.text
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let x = 0; x < GRID; x++) {
        const px = (x / (GRID - 1)) * w
        const py = midY - cur[row * GRID + x] * scale
        if (x === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    }

    let lastTs: number | null = null
    const animate = (ts: number) => {
      if (lastTs == null) lastTs = ts
      const dt = (ts - lastTs) / 1000
      lastTs = ts

      if (autoDripRef.current) {
        autoTimerRef.current += dt
        if (autoTimerRef.current >= dripIntervalRef.current) {
          autoTimerRef.current = 0
          const gx = 8 + Math.random() * (GRID - 16)
          const gy = 8 + Math.random() * (GRID - 16)
          addDroplet(gx, gy)
        }
      }

      physicsStep()
      renderWater()
      renderProfile()
      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)

    // Click / tap anywhere on the pond to drop a droplet at that point.
    const handlePointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const px = (e.clientX - rect.left) / rect.width
      const py = (e.clientY - rect.top) / rect.height
      addDroplet(px * GRID, py * GRID)
    }
    canvas.addEventListener('pointerdown', handlePointerDown)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', handleResize)
      canvas.removeEventListener('pointerdown', handlePointerDown)
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
          <span className="mono">SPECIMEN NO. 02</span>
          <h2>Water Droplet Ripple</h2>
        </div>
      </div>

      <div className="sim__body">
        <div className="sim__viewport">
          <div className="sim__panel sim__panel--pond">
            <canvas ref={canvasRef} className="sim__canvas" />
          </div>
          {showProfile && (
            <div className="sim__panel sim__panel--wave">
              <div className="sim__wave-legend">
                <span className="mono">
                  cross-section through last drop point
                </span>
              </div>
              <canvas
                ref={profileRef}
                className="sim__canvas sim__canvas--wave"
              />
            </div>
          )}
        </div>

        <div className="sim__controls">
          <div className="sim__control-group">
            <Dial
              label="Damping"
              value={damping}
              min={0.95}
              max={0.999}
              step={0.001}
              onChange={setDamping}
            />
            <Dial
              label="Droplet radius"
              value={dropletRadius}
              min={1}
              max={10}
              step={0.5}
              unit="cells"
              onChange={setDropletRadius}
            />
            <Dial
              label="Droplet strength"
              value={dropletStrength}
              min={0.5}
              max={5}
              step={0.1}
              onChange={setDropletStrength}
            />
          </div>

          <div className="sim__control-group">
            <Switch
              label="Auto-drip"
              checked={autoDrip}
              onChange={setAutoDrip}
              swatch="var(--teal)"
            />
            {autoDrip && (
              <Dial
                label="Drip interval"
                value={dripInterval}
                min={0.3}
                max={3}
                step={0.1}
                unit="s"
                onChange={setDripInterval}
              />
            )}
            <Switch
              label="Cross-section plot"
              checked={showProfile}
              onChange={setShowProfile}
            />
          </div>

          <div className="sim__buttons">
            <button className="sim__btn sim__btn--primary" onClick={reset}>
              Clear pond
            </button>
          </div>

          <p className="sim__note">
            Click anywhere on the pond to drop water. Each cell's height
            updates from its four neighbors via a discretized 2D wave
            equation — <code className="mono">
              h[x,y] ← (Σ neighbors)/2 − h_prev[x,y]
            </code>{' '}
            — which is why the disturbance spreads as an expanding
            circular ring rather than staying local. Shading comes from
            the surface normal of the height field, lit like a real pond
            from above.
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
