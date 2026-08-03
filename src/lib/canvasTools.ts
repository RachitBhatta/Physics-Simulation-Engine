// Draggable measurement tools shared across sims. These are drawn
// directly on a sim's canvas (not DOM elements), so each sim owns a
// position ref for each tool and wires pointer events to the hit-test
// helpers below before falling through to its own interaction logic.

export interface ToolPos {
  x: number
  y: number
}

export interface ToolColors {
  panel: string
  axis: string
  text: string
  brass: string
}

export const RULER_W = 30
export const RULER_H = 190
export const STOPWATCH_W = 108
export const STOPWATCH_H = 44
const RESET_R = 7

export function drawDraggableRuler(
  ctx: CanvasRenderingContext2D,
  pos: ToolPos,
  colors: ToolColors,
) {
  ctx.save()
  ctx.translate(pos.x, pos.y)
  ctx.fillStyle = '#f0e0b8'
  ctx.fillRect(0, 0, RULER_W, RULER_H)
  ctx.strokeStyle = colors.axis
  ctx.lineWidth = 1.5
  ctx.strokeRect(0.5, 0.5, RULER_W - 1, RULER_H - 1)
  ctx.strokeStyle = '#5a4326'
  ctx.font = '9px var(--font-mono, monospace)'
  ctx.fillStyle = '#5a4326'
  const divisions = 19
  for (let i = 0; i <= divisions; i++) {
    const y = 4 + (i / divisions) * (RULER_H - 8)
    const long = i % 5 === 0
    ctx.lineWidth = long ? 1.4 : 0.8
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(long ? 12 : 7, y)
    ctx.stroke()
    if (long && i < divisions) {
      ctx.fillText(String(i), 13, y + 3)
    }
  }
  // grip dots to signal "this is draggable"
  ctx.fillStyle = colors.brass
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    ctx.arc(RULER_W - 8, RULER_H / 2 - 8 + i * 8, 1.6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawDraggableStopwatch(
  ctx: CanvasRenderingContext2D,
  pos: ToolPos,
  elapsedSeconds: number,
  colors: ToolColors,
) {
  ctx.save()
  ctx.translate(pos.x, pos.y)
  ctx.fillStyle = colors.panel
  ctx.strokeStyle = colors.axis
  ctx.lineWidth = 1.5
  roundRect(ctx, 0, 0, STOPWATCH_W, STOPWATCH_H, 8)
  ctx.fill()
  ctx.stroke()

  ctx.font = '15px var(--font-mono, monospace)'
  ctx.fillStyle = colors.text
  ctx.textAlign = 'left'
  ctx.fillText(elapsedSeconds.toFixed(1) + ' s', 10, 27)

  // reset button, top-right corner
  const rx = STOPWATCH_W - 16
  const ry = 16
  ctx.beginPath()
  ctx.arc(rx, ry, RESET_R, 0, Math.PI * 2)
  ctx.strokeStyle = colors.brass
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(rx, ry, 2, 0, Math.PI * 2)
  ctx.fillStyle = colors.brass
  ctx.fill()
  ctx.restore()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function hitTestRuler(pos: ToolPos, px: number, py: number) {
  return px >= pos.x && px <= pos.x + RULER_W && py >= pos.y && py <= pos.y + RULER_H
}

export function hitTestStopwatch(pos: ToolPos, px: number, py: number) {
  return px >= pos.x && px <= pos.x + STOPWATCH_W && py >= pos.y && py <= pos.y + STOPWATCH_H
}

export function hitTestStopwatchReset(pos: ToolPos, px: number, py: number) {
  const rx = pos.x + STOPWATCH_W - 16
  const ry = pos.y + 16
  return Math.hypot(px - rx, py - ry) <= RESET_R + 3
}
