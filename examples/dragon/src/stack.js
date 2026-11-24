// Draws a sprite stack through the camera, at any heading, bank and pitch.
//
// Every cell of every slice is a little flat tile in the world. Its centre is projected like
// any other point, and then every screen pixel whose centre lies inside the tile's outline is
// filled. Because the tiles of a slice fit together without gaps, so do the pixels: a turned
// slice has no pin-holes, at any size.

import { hash2 } from './rng.js'
import { BAYER4 } from './framebuffer.js'

const AX = { rx: 0, ry: 0, rz: 0, fx: 0, fy: 0, fz: 0, ux: 0, uy: 0, uz: 0 }
const REACH = 0.53 // half a cell, plus a sliver so neighbouring tiles overlap instead of leaving seams
let order = new Int32Array(0)
let rank = new Float64Array(0)

/**
 * A model's own axes in the world (x east, y south, z up): its right side, its front, and up
 * through its top. A positive roll dips the right side; a positive pitch lifts the front.
 */
export function stackAxes(yaw, roll, pitch, out = AX) {
  const sy = Math.sin(yaw)
  const cy = Math.cos(yaw)
  const sr = Math.sin(roll)
  const cr = Math.cos(roll)
  const sp = Math.sin(pitch)
  const cp = Math.cos(pitch)
  out.rx = cy * cr
  out.ry = sy * cr
  out.rz = -sr
  const lx = cy * sr // "up" after the roll, before the pitch
  const ly = sy * sr
  const lz = cr
  out.fx = sy * cp + lx * sp
  out.fy = -cy * cp + ly * sp
  out.fz = lz * sp
  out.ux = lx * cp - sy * sp
  out.uy = ly * cp + cy * sp
  out.uz = lz * cp
  return out
}

/**
 * pose: { x, y, z, yaw, roll, pitch, scale, spread, thrust, solid }
 *   spread: how far apart the slices are drawn (1 is solid; more pulls the stack apart)
 *   thrust: 0..1, how long the engine flames are
 *   solid:  1 draws every pixel (the default); less leaves pixels out in a dither pattern,
 *           so the stack dissolves; 0 draws nothing
 */
export function drawStack(fb, cam, model, pose, time) {
  const W = fb.width
  const H = fb.height
  const color = fb.color
  const zbuf = fb.depth
  const mask = fb.mask
  const { sin, cos, persp, tilt, zoom, cx, cy } = cam
  const s = pose.scale
  const solid = pose.solid ?? 1
  if (solid <= 0) return
  const ink = solid >= 1 ? 16 : solid * 16 // a pixel is drawn where this beats its dither threshold
  stackAxes(pose.yaw, pose.roll, pose.pitch, AX)

  // The craft's axes as the camera sees them, one cell long: across the screen (A), into it
  // (D) and up (Z).
  const rA = (AX.rx * cos + AX.ry * sin) * s
  const rD = (AX.rx * sin - AX.ry * cos) * s
  const rZ = AX.rz * s
  const fA = (AX.fx * cos + AX.fy * sin) * s
  const fD = (AX.fx * sin - AX.fy * cos) * s
  const fZ = AX.fz * s
  const uA = (AX.ux * cos + AX.uy * sin) * s
  const uD = (AX.ux * sin - AX.uy * cos) * s
  const uZ = AX.uz * s
  const dx = pose.x - cam.x
  const dy = pose.y - cam.y
  const cA = dx * cos + dy * sin
  const cD = dx * sin - dy * cos
  const cZ = pose.z - cam.alt
  const den0 = 1 + persp * cD
  if (den0 < 0.2) return
  const k0 = zoom / den0

  // One cell along the wing and one along the body, in screen pixels, at the craft's centre.
  const rx = k0 * rA
  const ry = -k0 * (rZ + tilt * rD)
  const fx = k0 * fA
  const fy = -k0 * (fZ + tilt * fD)
  const det = rx * fy - fx * ry
  const edgeOn = Math.abs(det) < 0.04 * k0 * k0 * s * s // the slices are seen from the side: no area to fill
  const iux = fy / det
  const iuy = -fx / det
  const ivx = -ry / det
  const ivy = rx / det
  const halfX = (Math.abs(rx) + Math.abs(fx)) * REACH
  const halfY = (Math.abs(ry) + Math.abs(fy)) * REACH

  // Engine flames come out of the back, so they are nearer the eye than the craft when it
  // flies away. Breath comes out of the front, so it is nearer when the craft comes closer.
  const flamesInFront = model.breath ? fD < 0 : fD > 0
  if (!flamesInFront) drawFlames(fb, cam, model, pose, time, rA, rD, rZ, fA, fD, fZ, uA, uD, uZ, cA, cD, cZ)

  // Draw the slice farthest from eye level first and the nearest last, so nearer slices cover
  // farther ones. In the flat view the eye is infinitely far above (or below) the stack.
  let eye
  if (persp < 1e-6) eye = tilt * uZ - uD >= 0 ? 1e9 : -1e9
  else eye = (-cA * uA + (-1 / persp - cD) * uD + (tilt / persp - cZ) * uZ) / (s * s)
  const layers = model.layers
  if (order.length !== layers.length) {
    order = new Int32Array(layers.length)
    rank = new Float64Array(layers.length)
  }
  for (let n = 0; n < layers.length; n++) {
    order[n] = n
    rank[n] = Math.abs((n - model.pivotZ) * pose.spread - eye)
  }
  for (let i = 1; i < layers.length; i++) {
    const n = order[i]
    let j = i - 1
    while (j >= 0 && rank[order[j]] < rank[n]) {
      order[j + 1] = order[j]
      j--
    }
    order[j + 1] = n
  }

  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1
  const colors = model.colors
  for (let n = 0; n < layers.length; n++) {
    const layer = layers[order[n]]
    const count = layer.c.length
    if (count === 0) continue
    const lift = (order[n] - model.pivotZ) * pose.spread
    const bA = cA + lift * uA
    const bD = cD + lift * uD
    const bZ = cZ + lift * uZ
    const la = layer.a
    const lb = layer.b
    const lc = layer.c
    for (let v = 0; v < count; v++) {
      const a = la[v]
      const b = lb[v]
      const D = bD + a * rD + b * fD
      const den = 1 + persp * D
      if (den < 0.2) continue
      const k = zoom / den
      const sx = cx + k * (bA + a * rA + b * fA)
      const sy = cy - k * (bZ + a * rZ + b * fZ + tilt * D)
      const col = colors[lc[v]]
      const near = D - 1 // a hill or a cloud nearer than this hides the cell
      // the pixel nearest the cell's centre is always drawn …
      const px = Math.round(sx)
      const py = Math.round(sy)
      if (px >= 0 && py >= 0 && px < W && py < H) {
        const o = py * W + px
        if (zbuf[o] >= near) {
          if (ink === 16 || ink > BAYER4[((py & 3) << 2) | (px & 3)]) color[o] = col
          mask[o] = 1
        }
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
      }
      if (edgeOn) continue
      // … then every other pixel whose centre is inside the cell's outline
      const size = k / k0
      const inv = 1 / size
      let x0 = Math.ceil(sx - halfX * size)
      let x1 = Math.floor(sx + halfX * size)
      let y0 = Math.ceil(sy - halfY * size)
      let y1 = Math.floor(sy + halfY * size)
      if (x0 < 0) x0 = 0
      if (y0 < 0) y0 = 0
      if (x1 >= W) x1 = W - 1
      if (y1 >= H) y1 = H - 1
      for (let y = y0; y <= y1; y++) {
        const ey = y - sy
        for (let x = x0; x <= x1; x++) {
          const ex = x - sx
          const u = (ex * iux + ey * iuy) * inv
          if (u < -REACH || u > REACH) continue
          const w = (ex * ivx + ey * ivy) * inv
          if (w < -REACH || w > REACH) continue
          const o = y * W + x
          if (zbuf[o] < near) continue
          if (ink === 16 || ink > BAYER4[((y & 3) << 2) | (x & 3)]) color[o] = col
          mask[o] = 1
        }
      }
      if (x0 < minX) minX = x0
      if (x1 > maxX) maxX = x1
      if (y0 < minY) minY = y0
      if (y1 > maxY) maxY = y1
    }
  }

  // A dark one-pixel outline round the whole stack, so it reads over any background.
  if (maxX >= 0) {
    minX = Math.max(1, minX - 1)
    minY = Math.max(1, minY - 1)
    maxX = Math.min(W - 2, maxX + 1)
    maxY = Math.min(H - 2, maxY + 1)
    for (let y = minY; y <= maxY; y++) {
      let o = y * W + minX
      for (let x = minX; x <= maxX; x++, o++) {
        if (mask[o] === 0 && (mask[o - 1] | mask[o + 1] | mask[o - W] | mask[o + W]) === 1 && zbuf[o] >= cD - 2) {
          if (ink === 16 || ink > BAYER4[((y & 3) << 2) | (x & 3)]) color[o] = model.outline
        }
      }
    }
    for (let y = minY - 1; y <= maxY + 1; y++) mask.fill(0, y * W + minX - 1, y * W + maxX + 2)
  }

  if (flamesInFront) drawFlames(fb, cam, model, pose, time, rA, rD, rZ, fA, fD, fZ, uA, uD, uZ, cA, cD, cZ)
}

// Engine flames: behind each nozzle, a row of shrinking discs that is white-hot at the nozzle
// and cools to dark red at the tip. Breath (model.breath) goes forwards instead, and the
// discs grow as they go, so the fire opens into a cone. The shape is redrawn 24 times a second from a hash, so it
// flickers like hand-drawn fire and is the same on every run.
function drawFlames(fb, cam, model, pose, time, rA, rD, rZ, fA, fD, fZ, uA, uD, uZ, cA, cD, cZ) {
  const power = pose.thrust
  if (power <= 0.02 || pose.spread > 2.5 || (pose.solid ?? 1) < 0.5) return
  const W = fb.width
  const H = fb.height
  const color = fb.color
  const zbuf = fb.depth
  const { persp, tilt, zoom, cx, cy } = cam
  const frame = (time * 24) | 0
  const breath = model.breath
  const way = breath ? 0.5 : -0.5 // cells along the body from one disc to the next
  const discs = Math.ceil((3 + (breath ? 13 : 8) * power) * 2) // two discs per cell of length
  for (let n = 0; n < model.nozzles.length; n++) {
    const nozzle = model.nozzles[n]
    const bA = cA + nozzle.z * uA
    const bD = cD + nozzle.z * uD
    const bZ = cZ + nozzle.z * uZ
    for (let i = 0; i < discs; i++) {
      const along = i / discs
      const jitter = hash2(i + n * 97, frame) / 255
      const radius = model.nozzleRadius * (breath ? 0.5 + 2.2 * along : 1 - along) * (0.8 + 0.5 * jitter)
      if (radius < 0.25) continue
      const b = nozzle.b + i * way
      for (let off = -radius; off <= radius; off += 0.5) {
        const a = nozzle.a + off
        const D = bD + a * rD + b * fD
        const den = 1 + persp * D
        if (den < 0.2) continue
        const k = zoom / den
        // cooler further back and further from the middle; hotter with the thrusters open
        const cool = along * 3.4 + (Math.abs(off) / radius) * 1.4 + jitter * 0.6 - power
        const col = model.flame[cool < 0 ? 0 : cool >= 4 ? 4 : cool | 0]
        const px = Math.round(cx + k * (bA + a * rA + b * fA))
        const py = Math.round(cy - k * (bZ + a * rZ + b * fZ + tilt * D))
        const size = Math.max(1, Math.ceil(k * pose.scale * 0.55))
        for (let y = py; y < py + size; y++) {
          for (let x = px; x < px + size; x++) {
            if (x < 0 || y < 0 || x >= W || y >= H) continue
            const o = y * W + x
            if (zbuf[o] >= D - 1) color[o] = col
          }
        }
      }
    }
  }
}
