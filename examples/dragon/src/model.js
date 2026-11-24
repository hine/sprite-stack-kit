// A sprite stack is a pile of flat pixel pictures ("slices"), one per layer of height. Drawn
// one pixel apart and turned together, the pile reads as a solid 3D object.
//
// A model is a grid of palette indices, width × length × height, where 0 is empty:
//   i runs across, left to right        (width)
//   k runs along, front to back         (length)
//   z runs up, bottom slice to top      (height)
// and the cell (i, k, z) is at index (z × length + k) × width + i.
//
// The dragon below is built in code from a few simple shapes, so there is no image file to
// load. A model drawn by hand, or cut from top/side/front pictures, works the same way: fill
// a grid, then hand it to buildModel().

import { rgb } from './framebuffer.js'

export const CRAFT_W = 45 // across: wingtip to wingtip (odd, so there is a centre line)
export const CRAFT_L = 50 // along: snout (row 0) to the tip of the tail
export const CRAFT_H = 16 // layers: belly (0) to the tips of the raised wings
const CRAFT_SIZE = { width: CRAFT_W, length: CRAFT_L, height: CRAFT_H }

// Palette: three tones for each kind of surface, dark → light, then the eyes, which glow.
const SCALE = 1
const BELLY = 4
const WING = 7
const BONE = 10
const HORN = 13
const EYE = 16
const CRAFT_PALETTE = [
  null,
  [120, 26, 22], [178, 44, 30], [224, 84, 44],
  [190, 120, 48], [230, 166, 70], [252, 212, 118],
  [176, 70, 24], [226, 112, 36], [250, 158, 64],
  [84, 20, 22], [128, 32, 28], [170, 54, 36],
  [166, 148, 118], [212, 198, 166], [246, 236, 206],
  [255, 236, 96],
]
const OUTLINE = [42, 14, 14]
// The fire the dragon breathes: white-hot at the mouth, cooling to dark red.
const FLAME = [[255, 250, 222], [255, 222, 112], [255, 156, 48], [232, 84, 28], [140, 40, 34]]

const BODY_Z = 6 // the slice the body is centred on
const WING_Z = 7 // the slice the wings meet the body at
const SHOULDER = 3 // how far from the centre line the wings start
const SPAN = 22 // how far from the centre line the wingtips reach
const FLAP = 0.3 // how many slices a wing rises per cell outwards, at the top of a beat

// How the wing's edges run, for a distance `a` from the centre line. The leading edge
// reaches forward to a wrist, then sweeps back to the tip. The trailing edge is cut into
// scallops between the fingers, like a bat's.
const leading = (a) => (a <= 10 ? 18 - (a - SHOULDER) * 0.45 : 14.85 + (a - 10) * 0.6)
const trailing = (a) => 31 - (a - SHOULDER) * 0.42 - 3.4 * Math.abs(Math.sin(((a - SHOULDER) * Math.PI) / 6.4))

/**
 * Fills the dragon's grid with the first (darkest) tone of each surface. `flap` runs from −1
 * (wings down) through 0 (spread flat) to 1 (wings up). Edit this to change the dragon.
 */
function sculpt(flap = 0) {
  const grid = new Uint8Array(CRAFT_W * CRAFT_L * CRAFT_H)
  const mid = (CRAFT_W - 1) / 2
  const put = (a, k, z, kind) => {
    // `a` is measured from the centre line, so every shape is mirrored for free
    a = Math.round(a)
    k = Math.round(k)
    z = Math.round(z)
    if (k < 0 || k >= CRAFT_L || z < 0 || z >= CRAFT_H || Math.abs(a) > mid) return
    grid[(z * CRAFT_L + k) * CRAFT_W + mid + a] = kind
    grid[(z * CRAFT_L + k) * CRAFT_W + mid - a] = kind
  }
  // a round section at k: `wide` across, `tall` up, centred on slice `z0`, cream underneath
  const section = (k, wide, tall, z0) => {
    for (let z = 0; z < CRAFT_H; z++) {
      for (let a = 0; a <= mid; a++) {
        if ((a / wide) ** 2 + ((z - z0) / tall) ** 2 > 1) continue
        put(a, k, z, z < z0 - tall * 0.45 ? BELLY : SCALE)
      }
    }
  }

  // head: a narrow snout, then a wider skull
  for (let k = 0; k <= 9; k++) {
    const t = Math.min(1, k / 6)
    section(k, 0.9 + 1.7 * t, 0.8 + 1.3 * t, BODY_Z + 2.4 - 0.4 * t)
  }
  // neck, curving down into the shoulders
  for (let k = 9; k <= 16; k++) {
    const t = (k - 9) / 7
    section(k, 1.6 + 1.4 * t, 1.4 + 1 * t, BODY_Z + 1.8 - 1.8 * t)
  }
  // body: swells over the chest, slims towards the hips
  for (let k = 16; k <= 31; k++) {
    const t = (k - 16) / 15
    section(k, 3 + 1.2 * Math.sin(t * Math.PI) - 0.6 * t, 2.3 + 0.5 * Math.sin(t * Math.PI), BODY_Z)
  }
  // tail: tapers to a point, then a flat spade at the tip
  for (let k = 31; k <= 46; k++) {
    const t = (k - 31) / 15
    section(k, 2.4 * (1 - t) + 0.5, 1.8 * (1 - t) + 0.5, BODY_Z + 0.6 * t)
  }
  for (let k = 44; k <= 49; k++) {
    const half = 2.6 * (1 - Math.abs(k - 46.2) / 3)
    for (let a = 0; a <= half; a++) put(a, k, BODY_Z + 1, BONE)
  }
  // hind legs, tucked up under the hips, and small forelegs under the chest
  for (let k = 26; k <= 30; k++) for (let z = BODY_Z - 3; z <= BODY_Z - 1; z++) put(3, k, z, SCALE)
  for (let k = 29; k <= 31; k++) put(3, k, BODY_Z - 4, HORN)
  for (let k = 16; k <= 18; k++) put(2, k, BODY_Z - 3, SCALE)
  put(2, 15, BODY_Z - 3, HORN)

  // wings: a membrane one slice thick, with dark bones along the leading edge and the
  // fingers. A beat lifts or drops each wing about its shoulder.
  const lift = (a) => WING_Z + flap * FLAP * (a - SHOULDER)
  for (let a = SHOULDER; a <= SPAN; a++) {
    const front = leading(a)
    const back = Math.max(front + 1, trailing(a))
    for (let k = Math.floor(front); k <= back; k++) {
      put(a, k, lift(a), k <= front + 1 ? BONE : WING)
    }
  }
  // fingers: from the wrist out to the points between the scallops
  for (const tip of [SHOULDER + 6.4, SHOULDER + 12.8]) {
    const end = trailing(tip)
    for (let s = 0; s <= 1; s += 0.05) {
      const a = 10 + (tip - 10) * s
      put(a, leading(10) + (end - leading(10)) * s, lift(a), BONE)
    }
  }
  // the wing's root is thicker where it meets the body
  for (let k = 17; k <= 24; k++) for (let a = SHOULDER; a <= SHOULDER + 2; a++) put(a, k, lift(a) + 1, SCALE)

  // spikes along the spine, tallest over the shoulders
  for (let k = 10; k <= 43; k += 3) {
    const tall = k < 34 ? 2 : 1
    let top = 0
    for (let z = CRAFT_H - 1; z >= 0; z--) {
      if (grid[(z * CRAFT_L + k) * CRAFT_W + mid]) {
        top = z
        break
      }
    }
    for (let z = top + 1; z <= top + tall; z++) put(0, k, z, BONE)
  }
  // horns: two, sweeping up and back from the skull
  for (let t = 0; t <= 4; t += 0.5) put(1.6 + t * 0.15, 7 + t, BODY_Z + 3.6 + t * 0.9, HORN)
  // eyes
  put(2, 5, BODY_Z + 3, EYE)
  return grid
}

/**
 * Picks a tone for every visible cell from which way it faces: surfaces that face up and
 * towards the light get the light tone, surfaces that face away get the dark one. It expects
 * each surface to own three palette entries in a row (dark, mid, light) and the grid to hold
 * the dark one. Indices from `glowFrom` up are left alone. This is done once, so drawing the
 * model costs nothing extra.
 */
export function shadeGrid(grid, { width, length, height }, glowFrom = Infinity) {
  const at = (i, k, z) => (z * length + k) * width + i
  const filled = (i, k, z) => i >= 0 && k >= 0 && z >= 0 && i < width && k < length && z < height && grid[at(i, k, z)] !== 0
  const out = new Uint8Array(grid.length)
  for (let z = 0; z < height; z++) {
    for (let k = 0; k < length; k++) {
      for (let i = 0; i < width; i++) {
        const kind = grid[at(i, k, z)]
        if (!kind) continue
        if (kind >= glowFrom) {
          out[at(i, k, z)] = kind
          continue
        }
        // which way is open air? (right, towards the back, up)
        const nx = (filled(i + 1, k, z) ? 0 : 1) - (filled(i - 1, k, z) ? 0 : 1)
        const ny = (filled(i, k + 1, z) ? 0 : 1) - (filled(i, k - 1, z) ? 0 : 1)
        const nz = (filled(i, k, z + 1) ? 0 : 1) - (filled(i, k, z - 1) ? 0 : 1)
        const size = Math.sqrt(nx * nx + ny * ny + nz * nz)
        const facing = size ? (-0.42 * nx - 0.28 * ny + 0.86 * nz) / size : 0
        out[at(i, k, z)] = kind + (facing > 0.5 ? 2 : facing < -0.05 ? 0 : 1)
      }
    }
  }
  return out
}

/**
 * A grid as a short string: runs of (count, palette index) byte pairs, base64 encoded. A
 * stack is mostly empty space and flat colour, so this is far smaller than the grid or a PNG.
 * Use it to paste a finished model into a source file.
 */
export function encodeGrid(grid) {
  const bytes = []
  for (let i = 0; i < grid.length; ) {
    let run = 1
    while (run < 255 && i + run < grid.length && grid[i + run] === grid[i]) run++
    bytes.push(run, grid[i])
    i += run
  }
  let text = ''
  for (const b of bytes) text += String.fromCharCode(b)
  return btoa(text)
}

export function decodeGrid(encoded, size) {
  const text = atob(encoded)
  const grid = new Uint8Array(size)
  let o = 0
  for (let i = 0; i + 1 < text.length; i += 2) {
    const run = text.charCodeAt(i)
    grid.fill(text.charCodeAt(i + 1), o, o + run)
    o += run
  }
  return grid
}

/**
 * Turns a grid into what drawStack() draws from.
 *
 * spec: {
 *   width, length, height   the grid's size
 *   pivotK, pivotZ          the cell the model turns about: how far along, and which slice
 *   palette                 [null, [r, g, b], …]: entry n is the colour of palette index n
 *   outline                 [r, g, b] of the line drawn round the model (optional)
 *   nozzles, nozzleRadius   where flames come from (optional)
 *   breath                  true when the flames go forward, out of a mouth, and widen as they go
 *   wingtips                where trails come from (optional)
 * }
 * Nozzles and wingtips are { a, b, z }: cells right of the centre line, cells ahead of the
 * pivot, and slices above the pivot.
 */
export function buildModel(grid, spec) {
  const { width, length, height, pivotK, pivotZ } = spec
  const mid = (width - 1) / 2
  const layers = []
  const footprint = new Uint8Array(width * length) // the model from straight above, for its shadow
  let cells = 0
  for (let z = 0; z < height; z++) {
    const a = []
    const b = []
    const c = []
    for (let k = 0; k < length; k++) {
      for (let i = 0; i < width; i++) {
        const v = grid[(z * length + k) * width + i]
        if (!v) continue
        a.push(i - mid) // across: negative is the left side
        b.push(pivotK - k) // along: positive is towards the front
        c.push(v)
        footprint[k * width + i] = 1
      }
    }
    cells += c.length
    layers.push({ a: Float32Array.from(a), b: Float32Array.from(b), c: Uint8Array.from(c) })
  }
  const colors = new Uint32Array(spec.palette.length)
  for (let i = 1; i < spec.palette.length; i++) colors[i] = rgb(...spec.palette[i])
  return {
    width,
    length,
    height,
    pivotK,
    pivotZ,
    layers,
    footprint,
    cells,
    colors,
    outline: rgb(...(spec.outline ?? [20, 24, 40])),
    flame: (spec.flame ?? FLAME).map((c) => rgb(...c)),
    breath: !!spec.breath,
    nozzles: spec.nozzles ?? [],
    nozzleRadius: spec.nozzleRadius ?? 1.5,
    wingtips: spec.wingtips ?? [],
  }
}

export function sculptGrid(flap = 0) {
  return shadeGrid(sculpt(flap), CRAFT_SIZE, EYE)
}

/** The number of wing poses: from wings fully down, through flat, to fully up. */
export const FLAP_POSES = 7

/** The dragon with its wings at `flap` (−1..1). buildCraft() is the dragon with them spread flat. */
export function buildCraft(flap = 0) {
  const pivotK = 22
  const pivotZ = BODY_Z
  return buildModel(sculptGrid(flap), {
    ...CRAFT_SIZE,
    pivotK,
    pivotZ,
    palette: CRAFT_PALETTE,
    outline: OUTLINE,
    // fire comes out of the mouth, forwards
    breath: true,
    nozzles: [{ a: 0, b: pivotK + 0.5, z: BODY_Z + 2 - pivotZ }],
    nozzleRadius: 1.2,
    wingtips: [{ a: -SPAN, b: pivotK - trailing(SPAN), z: WING_Z - pivotZ }, { a: SPAN, b: pivotK - trailing(SPAN), z: WING_Z - pivotZ }],
  })
}

/** One dragon for each wing pose, from wings down (0) to wings up (FLAP_POSES − 1). */
export function buildFlaps() {
  const poses = []
  for (let n = 0; n < FLAP_POSES; n++) poses.push(buildCraft((n / (FLAP_POSES - 1)) * 2 - 1))
  return poses
}
