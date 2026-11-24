// Rolls the view.
//
// The ground is drawn in upright screen columns (see terrain.js), so it cannot be drawn at a
// slant. To bank the picture, the world is drawn upright on a "sheet" that is bigger than
// the frame, and the sheet is then copied into the frame, turned about the point the camera
// looks at. Only the cockpit view needs this: the other views keep the horizon level.

import { createFramebuffer } from './framebuffer.js'

/** A framebuffer with a pivot: the pixel of the sheet that lands on the camera's centre. */
export function createSheet() {
  const sheet = createFramebuffer()
  sheet.cx = 0
  sheet.cy = 0
  return sheet
}

/**
 * Gives the sheet memory for the worst case, which is the frame's diagonal each way. Call it
 * when the frame changes size, so that nothing is allocated while the game runs.
 */
export function sizeSheet(sheet, width, height) {
  const side = Math.ceil(Math.hypot(width, height)) + 4
  sheet.resize(side, side)
}

/**
 * Sets the sheet's size for this frame: just big enough to cover a width × height frame once
 * it has been turned by `angle` about the frame's point (cx, cy). The sheet uses only part of
 * its memory, so a gentle bank costs little more than a level view. Afterwards
 * (sheet.cx, sheet.cy) is the pivot to aim the camera at.
 */
export function fitSheet(sheet, width, height, cx, cy, angle) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  let left = 0
  let right = 0
  let top = 0
  let bottom = 0
  for (let corner = 0; corner < 4; corner++) {
    // where this corner of the frame is on the sheet, measured from the pivot
    const x = (corner & 1 ? width : 0) - cx
    const y = (corner & 2 ? height : 0) - cy
    const u = x * cos - y * sin
    const v = x * sin + y * cos
    if (u < left) left = u
    if (u > right) right = u
    if (v < top) top = v
    if (v > bottom) bottom = v
  }
  sheet.cx = Math.ceil(-left) + 1
  sheet.cy = Math.ceil(-top) + 1
  sheet.width = sheet.cx + Math.ceil(right) + 1
  sheet.height = sheet.cy + Math.ceil(bottom) + 1
}

/**
 * Copies the sheet into the frame, turned by `angle` about the frame's point (cx, cy). A
 * positive angle is a bank to the right, which lifts the right-hand end of the horizon.
 */
export function pasteRolled(fb, sheet, cx, cy, angle) {
  const W = fb.width
  const H = fb.height
  const out = fb.color
  const from = sheet.color
  const stride = sheet.width
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  let o = 0
  for (let y = 0; y < H; y++) {
    // Where the first pixel of this row is on the sheet. Every pixel to its right is one
    // more step along (cos, sin), so the whole row costs two additions per pixel.
    let u = sheet.cx + 0.5 - cx * cos - (y - cy) * sin
    let v = sheet.cy + 0.5 - cx * sin + (y - cy) * cos
    for (let x = 0; x < W; x++, u += cos, v += sin) out[o++] = from[(v | 0) * stride + (u | 0)]
  }
}
