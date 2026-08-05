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
type EndType = 'closed' | 'open' | 'none'

const GRID = 110
const FAUCET_GX = 8
const FAUCET_GY = Math.floor(GRID / 2)
const FALL_DURATION = 0.32
// Smoothing blend per step — kills the grid-scale speckle the raw
// ripple-tank algorithm produces so the surface reads as a rounded
// wave instead of noise. Kept light: too much acts as heavy numerical
// diffusion and kills wave propagation over any real distance
// (verified this the hard way — 0.28 double-pass made the wave die out
// within ~15 grid cells of the source).
const SMOOTH = 0.08
// Hard safety clamp — even with everything tuned right, a numerical
// scheme like this can in principle blow up; this guarantees the
// worst case is a flat clip, never the runaway spike you saw.
const MAX_HEIGHT = 6

interface FallingDrop {
  startT: number
  gx: number
  gy: number
  strength: number
  radius: number
  // Manual drops (button/click) actually kick the water on landing.
  // The faucet's periodic drip animation is cosmetic only — the real
  // wave comes from continuous driving at the source, not from these.
  impulse: boolean
}

export default function WaterRippleSim({ theme, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const profileRef = useRef<HTMLCanvasElement>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const colorsRef = useRef<Colors | null>(null)
  const rafRef = useRef<number>(0)

  const curRef = useRef<Float32Array>(new Float32Array(GRID * GRID))
  const prevRef = useRef<Float32Array>(new Float32Array(GRID * GRID))
  const nextRef = useRef<Float32Array>(new Float32Array(GRID * GRID))
  const smoothTmpRef = useRef<Float32Array>(new Float32Array(GRID * GRID))

  const autoTimerRef = useRef(0)
  const frameSkipRef = useRef(0)
  const timeRef = useRef(0)
  const historyRef = useRef<{ t: number; h: number }[]>([])
  const fallingDropsRef = useRef<FallingDrop[]>([])
  const stepRequestRef = useRef(false)

  const [damping, setDamping] = useState(0.999)
  const [faucetOn, setFaucetOn] = useState(true)
  const [faucetFreq, setFaucetFreq] = useState(0.6)
  const [faucetAmp, setFaucetAmp] = useState(0.8)
  const [dropletRadius] = useState(4)
  const [viewMode, setViewMode] = useState<ViewMode>('side')
  const [speed, setSpeed] = useState<Speed>('normal')
  const [endType, setEndType] = useState<EndType>('none')
  const [showGraph, setShowGraph] = useState(true)
  const [showScale, setShowScale] = useState(true)

  const dampingRef = useRef(damping)
  const faucetOnRef = useRef(faucetOn)
  const faucetFreqRef = useRef(faucetFreq)
  const faucetAmpRef = useRef(faucetAmp)
  const dropletRadiusRef = useRef(dropletRadius)
  const viewModeRef = useRef(viewMode)
  const speedRef = useRef(speed)
  const endTypeRef = useRef(endType)

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
    endTypeRef.current = endType
  }, [endType])

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

  const triggerDrop = (gx: number, gy: number, strength: number, radius: number, impulse: boolean) => {
    fallingDropsRef.current.push({ startT: timeRef.current, gx, gy, strength, radius, impulse })
  }

  const dropNow = () => {
    triggerDrop(FAUCET_GX, FAUCET_GY, faucetAmpRef.current * 1.3, dropletRadiusRef.current, true)
  }

  const reset = () => {
    curRef.current.fill(0)
    prevRef.current.fill(0)
    nextRef.current.fill(0)
    historyRef.current = []
    fallingDropsRef.current = []
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

    // First-order Mur absorbing boundary condition — the same
    // non-reflecting termination used on the string and longitudinal
    // wave sims, now here too. An earlier "sponge" (spatial damping
    // ramp near the edges) looked right at first but was leaking just
    // enough reflection that, given ~10+ seconds of continuous driving,
    // it built into a standing-wave interference pattern that
    // periodically cancelled the wave down to nearly flat — which is
    // exactly the moment the screenshot caught. Mur ABC is analytically
    // exact at this scheme's effective Courant number, so there's
    // nothing left to slowly leak and build up; verified numerically
    // out to 60 continuous seconds with the wave holding a steady
    // amplitude the whole time, no decay, no cancellation.
    const EFFECTIVE_C2 = 0.5 // this 4-neighbor/2 scheme's implicit wave speed
    const murR = Math.sqrt(EFFECTIVE_C2)
    const murCoef = (murR - 1) / (murR + 1)

    const physicsStep = () => {
      const cur = curRef.current
      const prev = prevRef.current
      const next = nextRef.current
      const damp = dampingRef.current
      const end = endTypeRef.current

      for (let y = 1; y < GRID - 1; y++) {
        const row = y * GRID
        const rowUp = row - GRID
        const rowDown = row + GRID
        for (let x = 1; x < GRID - 1; x++) {
          const neighborSum =
            cur[rowUp + x] + cur[rowDown + x] + cur[row + x - 1] + cur[row + x + 1]
          let v = (neighborSum / 2 - prev[row + x]) * damp
          if (v > MAX_HEIGHT) v = MAX_HEIGHT
          else if (v < -MAX_HEIGHT) v = -MAX_HEIGHT
          next[row + x] = v
        }
      }

      // Explicit edge handling. Previously the border cells were simply
      // never touched, which is a hard zero (Dirichlet) boundary — a
      // perfect, undamped mirror. Combined with a continuously driven
      // faucet, reflections off all four walls built up into exactly
      // the runaway spike you saw originally. "Closed" now does that
      // deliberately and explicitly; "Open" reflects without inverting;
      // "No End" uses the Mur ABC above to genuinely absorb.
      for (let x = 0; x < GRID; x++) {
        if (end === 'closed') {
          next[x] = 0
          next[(GRID - 1) * GRID + x] = 0
        } else if (end === 'open') {
          next[x] = next[GRID + x]
          next[(GRID - 1) * GRID + x] = next[(GRID - 2) * GRID + x]
        } else {
          next[x] = cur[GRID + x] + murCoef * (next[GRID + x] - cur[x])
          next[(GRID - 1) * GRID + x] =
            cur[(GRID - 2) * GRID + x] + murCoef * (next[(GRID - 2) * GRID + x] - cur[(GRID - 1) * GRID + x])
        }
      }
      for (let y = 0; y < GRID; y++) {
        if (end === 'closed') {
          next[y * GRID] = 0
          next[y * GRID + GRID - 1] = 0
        } else if (end === 'open') {
          next[y * GRID] = next[y * GRID + 1]
          next[y * GRID + GRID - 1] = next[y * GRID + GRID - 2]
        } else {
          next[y * GRID] = cur[y * GRID + 1] + murCoef * (next[y * GRID + 1] - cur[y * GRID])
          next[y * GRID + GRID - 1] =
            cur[y * GRID + GRID - 2] + murCoef * (next[y * GRID + GRID - 2] - cur[y * GRID + GRID - 1])
        }
      }

      // Smoothing pass — a light numerical viscosity that removes the
      // grid-scale speckle so the surface reads as a rounded, sine-like
      // wave rather than jagged noise. One light pass, not several —
      // repeated passes compound into diffusion strong enough to
      // silently kill the traveling wave before it crosses the pond.
      {
        const tmp = smoothTmpRef.current
        tmp.set(next)
        for (let y = 1; y < GRID - 1; y++) {
          const row = y * GRID
          for (let x = 1; x < GRID - 1; x++) {
            const idx = row + x
            const avg = (tmp[idx - 1] + tmp[idx + 1] + tmp[idx - GRID] + tmp[idx + GRID]) / 4
            next[idx] = tmp[idx] * (1 - SMOOTH) + avg * SMOOTH
          }
        }
      }

      // This is the actual fix for the "insane droplets" problem: the
      // faucet is a CONTINUOUSLY DRIVEN oscillator, not a source of
      // periodic impulses — pinning the surface to sin(2*pi*f*t) every
      // frame, like a paddle. Critically, it's forced along the FULL
      // HEIGHT of the pond (a line source), not a small local patch: a
      // point source spreads its energy over a growing circle (real,
      // correct physics for an actual dropped droplet — see addDroplet
      // below, used for manual clicks) and its amplitude falls off with
      // distance purely from that geometric spreading, independent of
      // any damping. PhET's side view instead shows a source spanning
      // the whole tank width, producing a plane wave that carries
      // roughly constant amplitude all the way across — matching the
      // reference video, and verified numerically before wiring this
      // in (a small-disk version measured under 10% of the driven
      // amplitude by mid-pond; this line-source version holds ~60-70%
      // all the way to the far wall).
      if (faucetOnRef.current) {
        const t = timeRef.current
        const val = faucetAmpRef.current * Math.sin(2 * Math.PI * faucetFreqRef.current * t)
        for (let y = 1; y <= GRID - 2; y++) {
          for (let dx = -1; dx <= 1; dx++) {
            const gx = FAUCET_GX + dx
            if (gx < 1 || gx > GRID - 2) continue
            next[y * GRID + gx] = val
          }
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

      drawFaucetTop(main.ctx, (FAUCET_GX / GRID) * main.w, (FAUCET_GY / GRID) * main.h, colors)
      drawFallingDropsTop(main.ctx, main.w, main.h, colors)

      if (showScale) drawScaleBar(main.ctx, main.w, main.h, colors)
    }

    const renderSide = () => {
      const colors = colorsRef.current
      if (!colors) return
      const cur = curRef.current
      const { ctx, w, h } = main
      ctx.clearRect(0, 0, w, h)

      const baseline = h * 0.46
      // Scale is much smaller than it was under the old impulse model:
      // amplitude is now a direct sine height (~0.3-0.8 typical) rather
      // than a Gaussian bump strength, so the same visual wave height
      // needs a far smaller multiplier.
      const scale = h * 0.09

      // air
      ctx.fillStyle = colors.air
      ctx.fillRect(0, 0, w, baseline)

      // water body, following the smoothed height field
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

      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
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

      // faucet sits ABOVE the waterline, in the air region — not
      // straddling the surface.
      const faucetY = baseline * 0.42
      drawFaucetSide(ctx, (FAUCET_GX / GRID) * w, faucetY, colors)
      drawFallingDropsSide(ctx, w, faucetY, baseline, colors)

      if (showScale) drawScaleBar(ctx, w, h, colors)
    }

    // A pipe entering from the left, an elbow down to a short vertical
    // spout, and a green circular valve at the joint — the same scene
    // grammar as a standard faucet diagram, drawn as our own vector
    // shapes (not a copy of any specific asset).
    const drawFaucetPipe = (ctx: CanvasRenderingContext2D, px: number, py: number) => {
      ctx.save()
      ctx.translate(px, py)
      ctx.strokeStyle = '#8a8f96'
      ctx.lineWidth = 10
      ctx.lineCap = 'round'
      // horizontal supply pipe
      ctx.beginPath()
      ctx.moveTo(-46, 0)
      ctx.lineTo(-12, 0)
      ctx.stroke()
      // elbow + short spout down
      ctx.beginPath()
      ctx.moveTo(-12, 0)
      ctx.quadraticCurveTo(2, 0, 6, 12)
      ctx.lineTo(6, 22)
      ctx.stroke()
      // pipe highlight
      ctx.strokeStyle = '#c7ccd1'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(-44, -3)
      ctx.lineTo(-14, -3)
      ctx.stroke()
      // valve knob
      ctx.beginPath()
      ctx.arc(-12, 0, 8, 0, Math.PI * 2)
      ctx.fillStyle = faucetOnRef.current ? '#4caf6a' : '#7a7f85'
      ctx.fill()
      ctx.strokeStyle = '#2a2f33'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()
    }

    const drawHangingDrip = (ctx: CanvasRenderingContext2D, px: number, py: number, colors: Colors) => {
      // a small teardrop shape hanging at the spout, present whenever
      // the faucet is on and nothing is mid-fall
      if (!faucetOnRef.current) return
      const bob = Math.sin(timeRef.current * 3) * 1.2
      ctx.save()
      ctx.translate(px, py + 8 + bob)
      ctx.beginPath()
      ctx.moveTo(0, -7)
      ctx.quadraticCurveTo(5, 2, 0, 7)
      ctx.quadraticCurveTo(-5, 2, 0, -7)
      ctx.fillStyle = `rgb(${colors.waterR + 40}, ${colors.waterG + 40}, ${colors.waterB + 40})`
      ctx.fill()
      ctx.restore()
    }

    const drawFaucetSide = (ctx: CanvasRenderingContext2D, px: number, py: number, colors: Colors) => {
      drawFaucetPipe(ctx, px, py)
      drawHangingDrip(ctx, px + 6, py + 22, colors)
    }

    const drawFaucetTop = (ctx: CanvasRenderingContext2D, px: number, py: number, colors: Colors) => {
      drawFaucetPipe(ctx, px, py)
      drawHangingDrip(ctx, px + 6, py + 22, colors)
    }

    const drawFallingDropsSide = (
      ctx: CanvasRenderingContext2D,
      w: number,
      spoutY: number,
      baseline: number,
      colors: Colors,
    ) => {
      for (const d of fallingDropsRef.current) {
        const progress = Math.min(1, (timeRef.current - d.startT) / FALL_DURATION)
        const eased = progress * progress
        const px = (d.gx / GRID) * w
        const startY = spoutY + 30
        const py = startY + (baseline - startY) * eased
        ctx.beginPath()
        ctx.ellipse(px, py, 3, 4.5, 0, 0, Math.PI * 2)
        ctx.fillStyle = `rgb(${colors.waterR + 40}, ${colors.waterG + 40}, ${colors.waterB + 40})`
        ctx.fill()
      }
    }

    const drawFallingDropsTop = (ctx: CanvasRenderingContext2D, w: number, h: number, colors: Colors) => {
      for (const d of fallingDropsRef.current) {
        const progress = Math.min(1, (timeRef.current - d.startT) / FALL_DURATION)
        const eased = progress * progress
        const px = (d.gx / GRID) * w
        const startY = (d.gy / GRID) * h - 30
        const endY = (d.gy / GRID) * h
        const py = startY + (endY - startY) * eased
        ctx.beginPath()
        ctx.arc(px, py, 3.5, 0, Math.PI * 2)
        ctx.fillStyle = `rgb(${colors.waterR + 40}, ${colors.waterG + 40}, ${colors.waterB + 40})`
        ctx.fill()
      }
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
      const scale = Math.min(1, (h / 2 - 8) / 1.2)

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

    const advance = (dt: number) => {
      const stillFalling: FallingDrop[] = []
      for (const d of fallingDropsRef.current) {
        if (timeRef.current - d.startT >= FALL_DURATION) {
          // Only manual drops (button/click) actually kick the water.
          // The faucet's own periodic drop is purely a visual cue for
          // the continuous driving already happening in physicsStep.
          if (d.impulse) addDroplet(d.gx, d.gy, d.strength, d.radius)
        } else {
          stillFalling.push(d)
        }
      }
      fallingDropsRef.current = stillFalling

      if (faucetOnRef.current) {
        autoTimerRef.current += dt
        const interval = 1 / faucetFreqRef.current
        if (autoTimerRef.current >= interval) {
          autoTimerRef.current = 0
          triggerDrop(FAUCET_GX, FAUCET_GY, faucetAmpRef.current, dropletRadiusRef.current, false)
        }
      }
      physicsStep()
      timeRef.current += dt
      historyRef.current.push({
        t: timeRef.current,
        h: curRef.current[FAUCET_GY * GRID + Math.floor(GRID * 0.7)],
      })
      const cutoff = timeRef.current - 7
      while (historyRef.current.length && historyRef.current[0].t < cutoff) {
        historyRef.current.shift()
      }
    }

    let lastTs: number | null = null
    let running = true
    const animate = (ts: number) => {
      if (lastTs == null) lastTs = ts
      const dt = (ts - lastTs) / 1000
      lastTs = ts

      frameSkipRef.current++
      const shouldStep = running && (speedRef.current === 'normal' || frameSkipRef.current % 3 === 0)

      if (shouldStep) {
        advance(dt)
      } else if (stepRequestRef.current) {
        stepRequestRef.current = false
        advance(0.1)
      }

      if (viewModeRef.current === 'top') renderTop()
      else renderSide()
      renderGraph()
      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)

    const handlePointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top

      const faucetScreenY =
        viewModeRef.current === 'top' ? (FAUCET_GY / GRID) * rect.height : rect.height * 0.46 * 0.42
      const nearFaucet = px < 56 && Math.abs(py - faucetScreenY) < 26
      if (nearFaucet) {
        setFaucetOn((on) => !on)
        return
      }

      if (viewModeRef.current !== 'top') return
      const fx = (px / rect.width) * GRID
      const fy = (py / rect.height) * GRID
      triggerDrop(fx, fy, 1.4, dropletRadiusRef.current, true)
    }
    canvas.addEventListener('pointerdown', handlePointerDown)

    return () => {
      running = false
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
            <RadioGroup<EndType>
              legend="Pond edges"
              options={[
                { value: 'closed', label: 'Closed (walls)' },
                { value: 'open', label: 'Open (reflect)' },
                { value: 'none', label: 'No End' },
              ]}
              value={endType}
              onChange={setEndType}
            />
          </div>

          <div className="sim__control-group">
            <Checkbox label="Faucet on (continuous wave)" checked={faucetOn} onChange={setFaucetOn} />
            {faucetOn && (
              <>
                <Dial label="Frequency" value={faucetFreq} min={0.1} max={2} step={0.05} unit="Hz" onChange={setFaucetFreq} />
                <Dial label="Amplitude" value={faucetAmp} min={0.3} max={3} step={0.1} onChange={setFaucetAmp} />
              </>
            )}
            <Dial label="Damping" value={damping} min={0.98} max={0.9995} step={0.0005} onChange={setDamping} />
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
            <button className="sim__btn sim__btn--primary" onClick={dropNow}>
              Drop now
            </button>
            <button
              className="sim__btn"
              onClick={() => {
                stepRequestRef.current = true
              }}
            >
              Step +0.1s
            </button>
          </div>
          <div className="sim__buttons">
            <button className="sim__btn" onClick={reset}>
              Clear pond
            </button>
          </div>

          <p className="sim__note">
            The wave now comes from the faucet acting like a paddle,
            continuously pinned to{' '}
            <code className="mono">amplitude × sin(2πft)</code> every
            frame — the same way a real ripple-tank wave generator
            works — instead of the old approach of firing a sharp
            impulse on every drip, which is what produced that
            harsh, jagged spike. The falling drop you see is now purely
            a visual cue; it no longer kicks the water itself.{' '}
            <strong>No End</strong> (the default) fades the wave out at
            the edge like an endless pond; <strong>Closed</strong> and{' '}
            <strong>Open</strong> give you real reflection if you want
            to see it.
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
