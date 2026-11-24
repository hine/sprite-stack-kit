// The saddle: what the rider sees from the dragon's back, laid over the world when the camera
// sits in the saddle.
//
// The fixed parts are painted once for each frame size into one layer, where a pixel of 0 is
// see-through: the dragon's back and neck running away from the rider to its horned head, the
// front of the saddle, the rider's gloved hands, and the reins from the hands to the head.
// Each frame the layer is copied over the world, and then the live parts are drawn from the
// dragon's numbers: the beating wings, the fire, the head-up display, the compass on the
// saddle, and the map and the numbers on the two saddlebags. Nothing is loaded from an image
// file.

import { rgb, mix } from './framebuffer.js'
import { WORLD_MASK, WORLD_SHIFT, MAT } from './world.js'
import { dot, box, line, disc, text, number } from './paint.js'
import { hash2 } from './rng.js'

const MARGIN = 6 // spare pixels round the layer, so it can sway and bob without showing an edge
const MAP_REACH = 5 // world px per pixel of the map

const BLACK = rgb(0, 0, 0)
const WHITE = rgb(244, 248, 255)
// leather, dark → light, and brass
const DARK = rgb(34, 18, 12)
const LOW = rgb(70, 38, 22)
const MID = rgb(112, 68, 36)
const FACE = rgb(140, 86, 46)
const LIGHT = rgb(214, 170, 84)
const BRASS = [rgb(120, 86, 34), rgb(186, 140, 60), rgb(240, 206, 120)]
const STITCH = rgb(226, 196, 140)
const GLOVE = [rgb(58, 34, 20), rgb(96, 60, 34), rgb(138, 92, 54)]
const REIN = [rgb(44, 24, 14), rgb(92, 54, 28)]
const AMBER = rgb(255, 196, 76)
const HUD = rgb(255, 214, 120)
const NEEDLE = rgb(220, 50, 40)
// the map and the numbers: old parchment in seven strengths, a little darker on every other row
const SCREEN = [rgb(58, 38, 24), rgb(86, 60, 36), rgb(118, 86, 52), rgb(150, 114, 70), rgb(186, 148, 96), rgb(220, 188, 132), rgb(250, 232, 184)]
const SCREEN_DIM = SCREEN.map((tone) => mix(tone, BLACK, 40))
// the dragon: scales in three tones, dark bone, ivory horns, an edge
const SCALE = [rgb(110, 24, 20), rgb(168, 42, 28), rgb(214, 80, 42)]
const BELLY = rgb(196, 122, 50)
const BONE = rgb(78, 18, 20)
const IVORY = [rgb(150, 132, 104), rgb(206, 192, 160), rgb(244, 234, 204)]
const EDGE = rgb(30, 10, 12)
const MEMBRANE = [rgb(150, 56, 22), rgb(212, 100, 34), rgb(246, 150, 60)]
const FIRE = [rgb(255, 250, 222), rgb(255, 222, 112), rgb(255, 156, 48), rgb(232, 84, 28), rgb(140, 40, 34)]
// how bright each kind of ground is on the map: water darkest, mesa tops brightest
const MAP_TONE = new Uint8Array(16)
MAP_TONE[MAT.DEEP] = 0
MAP_TONE[MAT.SEA] = 1
MAP_TONE[MAT.SHALLOW] = 2
MAP_TONE[MAT.SURF] = 2
MAP_TONE[MAT.SAND] = 5
MAP_TONE[MAT.GRASS] = 3
MAP_TONE[MAT.GRASS_DARK] = 3
MAP_TONE[MAT.GRASS_LIGHT] = 4
MAP_TONE[MAT.TREE] = 3
MAP_TONE[MAT.CROWN] = 4
MAP_TONE[MAT.ROCK] = 5
MAP_TONE[MAT.ROCK_DARK] = 4
MAP_TONE[MAT.SNOW] = 6
MAP_TONE[MAT.DUNE] = 4
MAP_TONE[MAT.DUNE_LIT] = 5
MAP_TONE[MAT.DUNE_DIM] = 3

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/**
 * Where everything goes for a frame size. The layout was drawn for a frame 240 pixels tall,
 * and every other size is that layout scaled. Positions are measured from the corner of the
 * layer, which is MARGIN larger than the frame on every side.
 */
function plan(width, height) {
  const unit = Math.min(height / 240, width / 384)
  const px = (n) => Math.max(1, Math.round(n * unit))
  const mid = MARGIN + (width >> 1)
  const cy = Math.round(height * 0.38) // the middle of the view, where the camera puts the nose (see aimCamera)
  const headW = clamp(px(18), 5, 80) // half the head's width
  const head = { x: mid, y: MARGIN + Math.round(height * 0.51), w: headW, h: Math.max(4, Math.round(headW * 0.75)) }
  const bottom = MARGIN + height
  const saddleW = px(118)
  const saddleTop = bottom - px(30)
  const bagW = px(74)
  const bagH = px(42)
  const letters = unit >= 1.4 ? 2 : 1
  return {
    width,
    height,
    unit,
    px,
    mid,
    cy,
    head,
    bottom,
    letters,
    shoulderY: MARGIN + Math.round(height * 0.78), // where the neck has widened into the back
    shoulder: width * 0.2, // half the back's width there
    saddle: { top: saddleTop, w: saddleW },
    compass: { x: mid, y: saddleTop + px(11), r: Math.max(3, px(8)) },
    hands: [{ x: mid - px(30), y: bottom - px(18) }, { x: mid + px(30), y: bottom - px(18) }],
    map: { x: MARGIN + px(10), y: bottom - bagH - px(8), w: bagW, h: bagH },
    data: { x: MARGIN + width - px(10) - bagW, y: bottom - bagH - px(8), w: bagW, h: bagH },
  }
}

/** Half the width of the dragon's neck and back at row `y`: narrow behind the head, then wider and wider towards the rider. */
function backHalf(p, y) {
  const neck = p.head.w * 0.8
  if (y <= p.shoulderY) {
    const s = clamp((y - p.head.y) / (p.shoulderY - p.head.y), 0, 1)
    return neck + (p.shoulder - neck) * Math.pow(s, 1.5)
  }
  return p.shoulder + (y - p.shoulderY) * 4
}

// ── the fixed parts, painted once per frame size

function paintLayer(p) {
  const width = p.width + MARGIN * 2
  const height = p.height + MARGIN * 2
  const color = new Uint32Array(width * height)
  const layer = { width, height, color }
  const set = (x, y, col) => {
    x = Math.round(x)
    y = Math.round(y)
    if (x >= 0 && y >= 0 && x < width && y < height) color[y * width + x] = col
  }
  const { head, px } = p

  // the neck and back: scales in rows that grow as they come nearer, lit along the top of the
  // spine and darker down the flanks
  for (let y = head.y; y < height; y++) {
    const half = backHalf(p, y)
    const near = (y - head.y) / (height - head.y) // 0 at the head, 1 at the rider
    const size = Math.max(2, Math.round(2 + 7 * near * near)) // how tall a row of scales is
    const row = Math.floor((y - head.y) / size)
    for (let x = Math.floor(p.mid - half - 1); x <= p.mid + half + 1; x++) {
      const across = (x - p.mid) / half // −1 … 1
      if (Math.abs(across) > 1) {
        if (Math.abs(across) < 1 + 1.5 / half) set(x, y, EDGE)
        continue
      }
      // each scale is an arc: its bottom edge is dark, and rows are offset by half a scale
      const into = (y - head.y) % size
      const sx = (x - p.mid + (row & 1 ? size : 0) + 4096) % (size * 2)
      const arc = into >= size - 1 - Math.round(Math.abs(sx - size) * 0.5 * (size > 3 ? 0.6 : 0))
      const side = Math.abs(across)
      let col = side > 0.82 ? SCALE[0] : side < 0.22 ? SCALE[2] : SCALE[1]
      if (arc && size > 2) col = side < 0.22 ? SCALE[1] : SCALE[0]
      if (side > 0.93 && y > p.shoulderY) col = BELLY // the paler hide where the flanks turn under
      set(x, y, col)
    }
  }
  // spines down the middle, pointing away from the rider, bigger as they come nearer
  for (let y = head.y + head.h + 2; y < p.saddle.top - px(6); ) {
    const near = (y - head.y) / (height - head.y)
    const size = Math.max(3, Math.round(3 + 12 * near))
    for (let i = 0; i < size; i++) {
      const half = (i + 1) * 0.55
      for (let x = -half; x <= half; x++) set(p.mid + x, y + i - size, i < 1 ? BONE : x < 0 ? SCALE[2] : BONE)
    }
    y += Math.round(size * 1.6) + 2
  }

  // the back of the head, and its horns
  for (let y = head.y - head.h; y <= head.y + head.h; y++) {
    for (let x = head.x - head.w - 1; x <= head.x + head.w + 1; x++) {
      const r = ((x - head.x) / head.w) ** 2 + ((y - head.y) / head.h) ** 2
      if (r > 1.25) continue
      set(x, y, r > 1 ? EDGE : r > 0.6 ? SCALE[0] : y < head.y - head.h * 0.3 ? SCALE[2] : SCALE[1])
    }
  }
  for (const side of [-1, 1]) {
    const x0 = head.x + side * head.w * 0.55
    const y0 = head.y - head.h * 0.55
    const reach = head.w * 1.5
    for (let s = 0; s <= 1; s += 0.5 / reach) {
      const x = x0 + side * reach * (0.55 * s + 0.15 * s * s)
      const y = y0 - reach * (0.9 * s - 0.25 * s * s)
      const thick = Math.max(0.6, (1 - s) * head.w * 0.28)
      for (let dy = -thick - 1; dy <= thick + 1; dy++) {
        for (let dx = -thick - 1; dx <= thick + 1; dx++) {
          const far = Math.hypot(dx, dy)
          if (far > thick + 1) continue
          const at = Math.round(y + dy) * width + Math.round(x + dx)
          if (far > thick) {
            if (color[at] === 0 || color[at] === EDGE) set(x + dx, y + dy, EDGE)
          } else set(x + dx, y + dy, IVORY[dy < -thick * 0.3 ? 2 : dy > thick * 0.3 ? 0 : 1])
        }
      }
    }
  }

  // the front of the saddle: a leather shield with a raised pommel, stitched round its edge
  const sTop = p.saddle.top
  const pommel = px(7)
  for (let y = sTop - pommel; y < height; y++) {
    const down = (y - sTop) / (height - sTop)
    const half = (p.saddle.w / 2) * (0.7 + 0.3 * clamp(down, 0, 1))
    for (let x = Math.floor(p.mid - half); x <= p.mid + half; x++) {
      const dx = Math.abs(x - p.mid)
      // the top edge rises into the pommel in the middle
      const top = sTop - pommel * Math.max(0, 1 - (dx / px(16)) ** 2)
      if (y < top) continue
      const edge = y - top < 1 || half - dx < 1
      const rim = y - top < px(2) || half - dx < px(2)
      set(x, y, edge ? DARK : rim ? (y - top < px(2) ? LIGHT : MID) : (x + y) % 5 === 0 ? MID : FACE)
      if (!edge && Math.abs(half - dx - px(4)) < 0.5 && y > top + px(4) && (y & 3) < 2) set(x, y, STITCH)
    }
  }
  // the compass, set into the pommel
  const c = p.compass
  disc(layer, c.x, c.y, c.r + 1.4, (dx, dy) => (dx + dy < -1 ? BRASS[2] : dx + dy > 1 ? BRASS[0] : BRASS[1]))
  disc(layer, c.x, c.y, c.r + 0.4, DARK)
  disc(layer, c.x, c.y, c.r - 0.6, SCREEN[5])

  // the saddlebags, strapped to the dragon's flanks: a parchment map in one, the numbers in the other
  for (const bag of [p.map, p.data]) {
    box(layer, bag.x - px(4), bag.y - px(4), bag.w + px(8), bag.h + px(12), DARK)
    box(layer, bag.x - px(3), bag.y - px(3), bag.w + px(6), bag.h + px(10), MID)
    box(layer, bag.x - px(3), bag.y - px(3), bag.w + px(6), 1, LIGHT)
    for (let x = bag.x - px(2); x < bag.x + bag.w + px(2); x += 3) box(layer, x, bag.y - px(2) + 1, 2, 1, STITCH)
    box(layer, bag.x - 1, bag.y - 1, bag.w + 2, bag.h + 2, DARK)
    // a strap and a buckle over the top
    const sx = bag.x + (bag.w >> 1) - px(4)
    box(layer, sx, bag.y - px(4), px(8), px(5), LOW)
    box(layer, sx + px(2), bag.y - px(3), px(4), px(3), BRASS[1])
  }

  // the reins: from each hand forward to the side of the dragon's jaw, sagging a little
  for (let n = 0; n < 2; n++) {
    const side = n === 0 ? -1 : 1
    const hand = p.hands[n]
    const x1 = head.x + side * head.w * 0.95
    const y1 = head.y + head.h * 0.35
    const steps = Math.ceil(Math.hypot(x1 - hand.x, y1 - hand.y))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = hand.x + (x1 - hand.x) * t
      const y = hand.y + (y1 - hand.y) * t + px(10) * 4 * t * (1 - t)
      const thick = Math.max(1, Math.round(px(2) * (1 - t * 0.6)))
      for (let k = 0; k < thick; k++) set(x + k * side, y, k === 0 ? REIN[1] : REIN[0])
      set(x - side, y, REIN[0])
    }
  }
  // the rider's hands, in leather gloves, holding the reins
  for (const hand of p.hands) {
    const w = px(10)
    const h = px(7)
    for (let y = -h; y <= h + px(4); y++) {
      for (let x = -w; x <= w; x++) {
        // a fist, with the cuff of the glove below it
        const r = y > h * 0.6 ? (Math.abs(x) <= w * 0.75 ? 0.5 : 2) : (x / w) ** 2 + (y / h) ** 2
        if (r > 1) continue
        const knuckle = y < -h * 0.2 && ((x + w + 4096) % Math.max(3, px(5))) < 1
        set(hand.x + x, hand.y + y, r > 0.8 ? GLOVE[0] : knuckle ? GLOVE[0] : y < -h * 0.4 ? GLOVE[2] : GLOVE[1])
      }
    }
  }
  return layer
}

/**
 * The wings, growing from the dragon's shoulders out past each side of the view. Each is a
 * bone along its front edge and a membrane behind it, scalloped between the fingers. `flap`
 * (−1..1) lifts or drops the tips, and the roots rise and fall a little with them.
 */
function drawWings(fb, p, left, top, flap) {
  const W = fb.width
  const H = fb.height
  const mid = left + p.mid
  const rootY = top + p.shoulderY - p.px(2)
  const reach = p.width * 0.62
  const lift = flap * p.height * 0.32
  for (const side of [-1, 1]) {
    const rootX = mid + side * p.shoulder * 0.7
    for (let i = 0; i <= reach; i++) {
      const s = i / reach
      const x = Math.round(rootX + side * i)
      if (x < 0 || x >= W) continue
      const front = rootY - p.height * (0.16 * s + 0.07 * Math.sin(s * Math.PI)) - lift * (0.15 + 0.85 * s * s)
      const depth = p.height * (0.08 + 0.09 * Math.abs(Math.sin(s * Math.PI * 2.4))) * (1 - 0.3 * s)
      const bone = Math.max(1, Math.round((1 - s) * p.height * 0.025 + 1))
      const y0 = Math.round(front)
      const y1 = Math.round(front + depth)
      for (let y = Math.max(0, y0 - 1); y <= y1 + 1 && y < H; y++) {
        const o = y * W + x
        if (y === y0 - 1 || y === y1 + 1) fb.color[o] = EDGE
        else if (y < y0 + bone) fb.color[o] = BONE
        else fb.color[o] = MEMBRANE[y < y0 + bone + 1 ? 2 : (y - y0) / (y1 - y0) > 0.7 ? 0 : 1]
      }
    }
  }
}

/** Fire from the dragon's mouth, out ahead of the head and on towards the horizon. */
function drawFire(fb, head, left, top, power, time) {
  if (power < 0.05) return
  const frame = (time * 24) | 0
  const steps = 10
  const x0 = left + head.x
  const y0 = top + head.y - head.h * 0.2
  const reach = head.h * (1.5 + 2.5 * power)
  for (let i = steps; i >= 0; i--) {
    const along = i / steps
    const jitter = hash2(i, frame) / 255
    const r = head.w * (0.2 + 0.4 * (1 - along)) * power * (0.8 + 0.4 * jitter)
    const x = x0 + (jitter - 0.5) * head.w * 0.4 * along
    const y = y0 - reach * along
    const cool = along * 3 + jitter * 0.8 + (1 - power)
    disc(fb, Math.round(x), Math.round(y), r, FIRE[cool < 0 ? 0 : cool >= 4 ? 4 : cool | 0])
  }
}

/** Copies a layer over the frame with its corner at (left, top), skipping see-through pixels. */
function stamp(fb, layer, left, top) {
  const x0 = Math.max(0, left)
  const x1 = Math.min(fb.width, left + layer.width)
  const y0 = Math.max(0, top)
  const y1 = Math.min(fb.height, top + layer.height)
  for (let y = y0; y < y1; y++) {
    let from = (y - top) * layer.width + (x0 - left)
    let to = y * fb.width + x0
    for (let x = x0; x < x1; x++, from++, to++) {
      const col = layer.color[from]
      if (col !== 0) fb.color[to] = col
    }
  }
}

// ── the live parts, drawn every frame

/**
 * The head-up display: marks that seem to float on the glass. The horizon line and its rungs
 * are level with the world, so they tilt against the bank and slide with the pitch; the nose
 * marker and the numbers stay put.
 */
function drawHud(fb, cam, g, p) {
  const cx = cam.cx
  const cy = cam.cy
  const cos = Math.cos(g.roll)
  const sin = Math.sin(g.roll)
  const lens = cam.zoom / cam.persp // screen pixels per unit of slope
  const reach = Math.min(p.width, p.height * 1.2) * 0.3
  for (let rung = -3; rung <= 3; rung++) {
    // rung 0 is the horizon; the others are ten degrees apart above and below it
    const below = g.horizon - lens * Math.tan((rung * Math.PI) / 18)
    const near = reach * (rung === 0 ? 0.2 : 0.16)
    const far = reach * (rung === 0 ? 1 : 0.42)
    const tick = rung > 0 ? 3 : -3
    for (let side = -1; side <= 1; side += 2) {
      // A point `along` the line and `below` the middle of the view lands at
      // (along × cos + below × sin, below × cos − along × sin) once the picture is banked.
      const x0 = cx + side * near * cos + below * sin
      const y0 = cy + below * cos - side * near * sin
      const x1 = cx + side * far * cos + below * sin
      const y1 = cy + below * cos - side * far * sin
      line(fb, x0, y0, x1, y1, HUD)
      if (rung !== 0) line(fb, x1, y1, x1 + tick * sin, y1 + tick * cos, HUD) // an end tick that points at the horizon
    }
  }
  // where the nose points
  line(fb, cx - 10, cy, cx - 4, cy, HUD)
  line(fb, cx + 4, cy, cx + 10, cy, HUD)
  line(fb, cx, cy - 8, cx, cy - 4, HUD)
  dot(fb, cx, cy, HUD)
  // speed on the left, height on the right, heading above
  const size = p.letters
  const side = Math.round(reach * 1.12)
  number(fb, cx - side - 11 * size, cy - 2 * size, g.speed, 3, HUD, size)
  number(fb, cx + side, cy - 2 * size, g.altitude, 3, HUD, size)
  number(fb, cx - 5 * size, cy - Math.round(reach * 0.62), degrees(g.heading), 3, HUD, size)
}

const degrees = (heading) => (((heading * 180) / Math.PI) % 360 + 360) % 360

/** The map: the ground around the craft from straight above, turned so that ahead is up. */
function drawMap(fb, x0, y0, w, h, world, craft) {
  const W = fb.width
  const H = fb.height
  const sin = Math.sin(craft.yaw)
  const cos = Math.cos(craft.yaw)
  const midX = w >> 1
  const midY = Math.round(h * 0.62) // the craft sits below the middle, so more of what is ahead shows
  for (let j = 0; j < h; j++) {
    const y = y0 + j
    if (y < 0 || y >= H) continue
    const tones = j & 1 ? SCREEN_DIM : SCREEN
    const back = (j - midY) * MAP_REACH
    for (let i = 0; i < w; i++) {
      const x = x0 + i
      if (x < 0 || x >= W) continue
      const right = (i - midX) * MAP_REACH
      const wx = craft.x + right * cos - back * sin
      const wy = craft.y + right * sin + back * cos
      const cell = ((Math.floor(wy) & WORLD_MASK) << WORLD_SHIFT) | (Math.floor(wx) & WORLD_MASK)
      fb.color[y * W + x] = tones[MAP_TONE[world.materials[cell]]]
    }
  }
  // the craft
  dot(fb, x0 + midX, y0 + midY - 2, WHITE)
  box(fb, x0 + midX - 1, y0 + midY - 1, 3, 1, WHITE)
  box(fb, x0 + midX - 2, y0 + midY, 5, 1, WHITE)
  // which way is north: a mark that rides round the edge of the screen. North is the
  // direction (−sin, −cos) from the craft, followed until it meets the nearest edge.
  const acrossRoom = (sin > 0 ? midX - 1 : w - 2 - midX) / Math.max(1e-6, Math.abs(sin))
  const downRoom = (cos > 0 ? midY - 1 : h - 2 - midY) / Math.max(1e-6, Math.abs(cos))
  const edge = Math.min(acrossRoom, downRoom)
  dot(fb, Math.round(x0 + midX - sin * edge), Math.round(y0 + midY - cos * edge), AMBER)
}

/** The compass on the pommel: its needle always points north, whichever way the dragon flies. */
function drawCompass(fb, x, y, radius, heading) {
  const sin = Math.sin(-heading)
  const cos = Math.cos(-heading)
  line(fb, x, y, x + sin * (radius - 1), y - cos * (radius - 1), NEEDLE)
  line(fb, x, y, x - sin * (radius - 2), y + cos * (radius - 2), DARK)
  dot(fb, x, y, BRASS[2])
}

/** The numbers screen: speed (ハヤサ), height (タカサ) and heading (ホウイ), and a bar for the fire. */
function drawReadout(fb, x, y, w, h, g) {
  const size = Math.max(1, Math.floor((w - 4) / 34))
  const row = 7 * size
  const left = x + 2 + size
  const top = y + ((h - 3 * row + 2 * size) >> 1)
  text(fb, left, top, 'ハヤサ', SCREEN[3], size)
  number(fb, left + 18 * size, top, g.speed, 3, SCREEN[6], size)
  text(fb, left, top + row, 'タカサ', SCREEN[3], size)
  number(fb, left + 18 * size, top + row, g.altitude, 3, SCREEN[6], size)
  text(fb, left, top + row * 2, 'ホウイ', SCREEN[3], size)
  number(fb, left + 18 * size, top + row * 2, degrees(g.heading), 3, SCREEN[6], size)
  // thrusters: six segments that fill from the bottom; two are lit when idling
  const barX = left + 31 * size
  const barW = x + w - 2 - barX
  const lit = Math.round(2 + g.boost * 4)
  for (let n = 0; n < 6; n++) {
    const tone = n >= lit ? SCREEN[1] : n >= 4 ? AMBER : SCREEN[5]
    box(fb, barX, top + 3 * row - 2 * size - (n + 1) * (row >> 1) + 1, barW, (row >> 1) - 1, tone)
  }
}

export function createCockpit() {
  let p = null
  let layer = null
  return {
    /** Paints the fixed parts for a frame size. */
    resize(width, height) {
      p = plan(width, height)
      layer = paintLayer(p)
    },
    /**
     * Draws the saddle view over the frame. `g` is the game's gauges (see game.js), and
     * `arrival` runs 0..1 as the camera comes into the saddle: the dragon's back rises into
     * view from below.
     */
    draw(fb, cam, world, craft, g, arrival) {
      if (!p) return
      const away = (1 - clamp(arrival, 0, 1)) ** 3 // quick to arrive, slow to settle
      // The back leans a little against a turn, rises and falls with each wing beat, and
      // shudders while the dragon breathes fire.
      const sway = -g.turn * 4
      const bob = Math.round(Math.sin(g.flap * 1.4) * p.px(2))
      const shake = g.boost > 0.5 && ((g.time * 30) & 1) === 1 ? 1 : 0
      const left = Math.round(sway) - MARGIN
      const top = Math.round(away * fb.height) + bob + shake - MARGIN

      drawFire(fb, p.head, left, top, g.boost, g.time)
      drawWings(fb, p, left, top, g.flap)
      stamp(fb, layer, left, top)
      if (away < 0.002) drawHud(fb, cam, g, p)
      drawCompass(fb, left + p.compass.x, top + p.compass.y, p.compass.r, g.heading)
      drawMap(fb, left + p.map.x, top + p.map.y, p.map.w, p.map.h, world, craft)
      drawReadout(fb, left + p.data.x, top + p.data.y, p.data.w, p.data.h, g)
    },
  }
}
