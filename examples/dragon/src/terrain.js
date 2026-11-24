// Draws the islands, the sea, the clouds and their shadows.
//
// The ground is swept from the nearest row of the view to the farthest. At every step of
// depth, each screen column looks up one ground pixel and draws it as a stack: the wall of
// the stack where it starts and its top where it ends. A pixel that is already taken stays
// taken, so nearer things always win and nothing is ever drawn twice.

import { EMPTY, BAYER4, mix } from './framebuffer.js'
import { horizonRow } from './camera.js'
import {
  WORLD_SIZE, WORLD_MASK, WORLD_SHIFT, CLOUD_SIZE, CLOUD_MASK, CLOUD_SHIFT,
  CLOUD_BASE, TOP_Z, SUN_X, SUN_Y, MAT, WATER_BELOW,
} from './world.js'

const VIEW_DISTANCE = 1200 // how far the chase view sees
const FOG_START = 260
const FOG_BANDS = 8 // distance haze comes in a few flat steps, not a smooth blend
const CLOUD_DRIFT_X = 6 // px per second
const CLOUD_DRIFT_Y = 2.5

const rowsNow = new Int32Array(TOP_Z + 2) // screen row of every height at this depth step
const rowsPrev = new Int32Array(TOP_Z + 2) // … and at the step before
let skyline = new Int32Array(0) // per column: the highest row the ground has reached

/**
 * `caster` is the craft, for its shadow: { x, y, z, cos, sin, across, along, footprint,
 * width, length, pivotK }, or null for no shadow.
 */
export function drawWorld(fb, cam, world, time, caster) {
  const W = fb.width
  const H = fb.height
  const color = fb.color
  const zbuf = fb.depth
  if (skyline.length < W) skyline = new Int32Array(W)
  skyline.fill(H, 0, W)

  const { sin, cos, persp, tilt, zoom, cx, cy, alt } = cam
  const { heights, materials, cloudMap, palette: pal } = world
  const { topLit, topShade, sideLit, sideShade, cloudTop, cloudSide, cloudUnder, haze, foam, glint } = pal

  // The camera's position, wrapped into the map and pushed well into positive numbers so that
  // `| 0` always rounds down.
  const baseX = cam.x - Math.floor(cam.x / WORLD_SIZE) * WORLD_SIZE + WORLD_SIZE * 4
  const baseY = cam.y - Math.floor(cam.y / WORLD_SIZE) * WORLD_SIZE + WORLD_SIZE * 4
  const driftX = (time * CLOUD_DRIFT_X) % CLOUD_SIZE
  const driftY = (time * CLOUD_DRIFT_Y) % CLOUD_SIZE
  const cloudX = CLOUD_SIZE * 16 - driftX
  const cloudY = CLOUD_SIZE * 16 - driftY
  const twinkle = (time * 40) | 0
  const surf = (time * 30) | 0

  let casterX = 0
  let casterY = 0
  let reach = 0
  if (caster) {
    casterX = baseX + (caster.x - cam.x)
    casterY = baseY + (caster.y - cam.y)
    reach = caster.length * 0.8 / caster.along + 3
  }

  // Start at the depth where the tallest thing in the world touches the bottom row, or right in
  // front of the eye when the eye is down among the hills and clouds.
  const below = H - cy
  const nearest = persp > 0 ? -0.8 / persp : -1e9
  const eye = persp > 0 ? alt + tilt / persp : 1e9
  const spread = zoom * tilt + persp * below
  let d = nearest
  if (eye > TOP_Z + 1 && spread > 1e-6) d = Math.max(nearest, (zoom * (alt - TOP_Z) - below) / spread - 2)
  // Stop when the sea has left the top of the frame, or at the view distance once there is a
  // horizon. From higher up the view reaches further.
  const viewDistance = VIEW_DISTANCE + 4 * alt
  const fogStart = FOG_START + 2.5 * alt
  const above = cy + 2
  let dEnd = viewDistance
  if (zoom * tilt > persp * above) dEnd = Math.min(viewDistance, (zoom * alt + above) / (zoom * tilt - persp * above))

  let den = 1 + persp * d
  let k = zoom / den
  let sea = cy - k * (tilt * d - alt) + 1e-5
  for (let z = 0; z <= TOP_Z; z++) rowsNow[z] = Math.floor(sea - k * z)
  const climb = zoom * (tilt + persp * alt) // how fast the sea climbs the screen as depth grows

  for (let guard = 0; d < dEnd && guard < 6000; guard++) {
    // One step deeper: about one screen row of sea, and never more than three screen columns'
    // worth of map, so distant ground is not skipped over.
    let step = (den * den) / climb
    const widest = (3 * den) / zoom
    if (step > widest) step = widest
    if (step < 0.5) step = 0.5
    d += step
    den = 1 + persp * d
    k = zoom / den
    sea = cy - k * (tilt * d - alt) + 1e-5
    for (let z = 0; z <= TOP_Z; z++) {
      rowsPrev[z] = rowsNow[z]
      rowsNow[z] = Math.floor(sea - k * z)
    }
    // one screen column to the right is this far across the map
    const stepX = cos / k
    const stepY = sin / k
    let wx = baseX + d * sin - cx * stepX
    let wy = baseY - d * cos - cx * stepY

    let fog = 0
    if (persp > 0 && d > fogStart) {
      const f = Math.min(1, (d - fogStart) / (viewDistance - fogStart))
      fog = Math.min(256, Math.round(Math.sqrt(f) * FOG_BANDS) * (256 / FOG_BANDS)) | 0
    }
    const crisp = k > 0.55 // sea glints are skipped where a map pixel is under about half a screen pixel

    for (let px = 0; px < W; px++, wx += stepX, wy += stepY) {
      const gx = wx | 0
      const gy = wy | 0

      // ── clouds: a stack of layers floating at CLOUD_BASE
      const thick = cloudMap[(((gy + cloudY) & CLOUD_MASK) << CLOUD_SHIFT) | ((gx + cloudX) & CLOUD_MASK)]
      if (thick !== 0) {
        const soft = thick === 1 // the thin rim is drawn as a checker, so cloud edges are soft
        // top face
        let y0 = rowsNow[CLOUD_BASE + thick]
        let y1 = rowsPrev[CLOUD_BASE + thick]
        if (y0 < 0) y0 = 0
        if (y1 > H) y1 = H
        if (y0 < y1) {
          const col = fog ? mix(cloudTop[thick], haze, fog) : cloudTop[thick]
          for (let y = y0, o = y0 * W + px; y < y1; y++, o += W) {
            if (color[o] !== EMPTY || (soft && ((px + y) & 1) === 0)) continue
            color[o] = col
            zbuf[o] = d
          }
        }
        // underside, when the eye is below the clouds
        y0 = rowsPrev[CLOUD_BASE]
        y1 = rowsNow[CLOUD_BASE]
        if (y0 < 0) y0 = 0
        if (y1 > H) y1 = H
        if (y0 < y1) {
          const col = fog ? mix(cloudUnder, haze, fog) : cloudUnder
          for (let y = y0, o = y0 * W + px; y < y1; y++, o += W) {
            if (color[o] !== EMPTY || (soft && ((px + y) & 1) === 0)) continue
            color[o] = col
            zbuf[o] = d
          }
        }
        // the wall facing the eye, one band per layer
        for (let layer = thick - 1; layer >= 0; layer--) {
          y0 = rowsPrev[CLOUD_BASE + layer + 1]
          y1 = rowsPrev[CLOUD_BASE + layer]
          if (y0 < 0) y0 = 0
          if (y1 > H) y1 = H
          if (y0 >= y1 || soft) continue
          const col = fog ? mix(cloudSide[layer], haze, fog) : cloudSide[layer]
          for (let y = y0, o = y0 * W + px; y < y1; y++, o += W) {
            if (color[o] === EMPTY) {
              color[o] = col
              zbuf[o] = d
            }
          }
        }
      }

      // ── ground
      const cell = ((gy & WORLD_MASK) << WORLD_SHIFT) | (gx & WORLD_MASK)
      const h = heights[cell]
      const top = rowsNow[h]
      let wall = rowsPrev[h]
      let edge = skyline[px]
      if (top >= edge && wall >= edge) continue // hidden behind nearer ground
      const mat = materials[cell]

      // in shade? first the clouds, then the craft
      let shaded = false
      const lift = CLOUD_BASE - h
      const over = cloudMap[
        ((((gy - SUN_Y * lift + cloudY) | 0) & CLOUD_MASK) << CLOUD_SHIFT) | (((gx - SUN_X * lift + cloudX) | 0) & CLOUD_MASK)
      ]
      if (over > 1) shaded = true
      else if (caster) {
        // Walk from this ground pixel towards the sun, up to the craft's height, and see
        // whether that spot is inside the craft's outline.
        const up = caster.z - h
        const qx = gx - casterX - SUN_X * up
        const qy = gy - casterY - SUN_Y * up
        if (qx > -reach && qx < reach && qy > -reach && qy < reach) {
          const i = Math.floor((qx * caster.cos + qy * caster.sin) * caster.across + caster.width / 2)
          const kk = Math.floor(caster.pivotK - (qx * caster.sin - qy * caster.cos) * caster.along + 0.5)
          if (i >= 0 && kk >= 0 && i < caster.width && kk < caster.length && caster.footprint[kk * caster.width + i] === 1) {
            shaded = true
          }
        }
      }

      let topCol = shaded ? topShade[mat] : topLit[mat]
      let sideCol = shaded ? sideShade[mat] : sideLit[mat]
      if (mat < WATER_BELOW) {
        if (mat === MAT.SURF) {
          // surf: foam that comes and goes
          if (((hash(gx, gy) + surf) & 255) < 110) topCol = shaded ? topShade[MAT.SHALLOW] : foam
        } else if (!shaded && crisp && ((hash(gx >> 1, gy) + twinkle) & 255) < 2) {
          topCol = glint // a short glint of sunlight on the water
        }
        sideCol = topCol
      }
      if (fog) {
        topCol = mix(topCol, haze, fog)
        sideCol = mix(sideCol, haze, fog)
      }

      // the wall of this stack, from where it starts down to what is already drawn …
      if (wall < edge) {
        if (wall < 0) wall = 0
        for (let y = wall, o = wall * W + px; y < edge; y++, o += W) {
          if (color[o] === EMPTY) {
            color[o] = sideCol
            zbuf[o] = d
          }
        }
        edge = wall
      }
      // … and its top, up to where it ends
      if (top < edge) {
        const y0 = top < 0 ? 0 : top
        for (let y = y0, o = y0 * W + px; y < edge; y++, o += W) {
          if (color[o] === EMPTY) {
            color[o] = topCol
            zbuf[o] = d
          }
        }
        edge = top
      }
      skyline[px] = edge
    }
  }
}

// A local copy of the cell hash: the inner loop above is the hottest code in the game.
function hash(x, y) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return h & 255
}

/**
 * Fills whatever the ground left empty: banded sky above the horizon, haze below it. `span`
 * is how many rows the whole sky takes, from the horizon to its darkest blue.
 */
export function drawSky(fb, cam, world, span = fb.height * 0.7) {
  const W = fb.width
  const H = fb.height
  const color = fb.color
  const { sky, haze } = world.palette
  const horizon = Math.min(H, Math.floor(horizonRow(cam)))
  const bands = sky.length
  for (let y = 0; y < H; y++) {
    let o = y * W
    if (y >= horizon) {
      for (let x = 0; x < W; x++, o++) if (color[o] === EMPTY) color[o] = haze
      continue
    }
    const t = ((horizon - y) / span) * (bands - 1)
    const band = t | 0
    const edge = (t - band - 0.65) * 3 // the top of each band dithers into the next
    for (let x = 0; x < W; x++, o++) {
      if (color[o] !== EMPTY) continue
      let b = band
      if (edge > 0 && edge * 16 > BAYER4[((y & 3) << 2) | (x & 3)]) b++
      color[o] = sky[b >= bands ? bands - 1 : b]
    }
  }
}
