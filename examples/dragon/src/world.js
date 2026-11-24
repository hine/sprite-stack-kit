// The world is a desert with a few oases, made as two wrapping maps from one seed:
//   · the ground: a height and a material for every pixel of the map
//   · the clouds: a thickness for every pixel of a smaller map, floating at one altitude
// Both are "stacks": terrain.js draws a ground pixel of height 6 as six layers.

import { makeRng, hash2, tileableNoise } from './rng.js'
import { rgb, tint } from './framebuffer.js'

// Sizes are powers of two so a position wraps with a bit mask instead of a division.
export const WORLD_SHIFT = 10
export const WORLD_SIZE = 1 << WORLD_SHIFT
export const WORLD_MASK = WORLD_SIZE - 1
export const GROUND_MAX = 34 // the tallest ground, trees included

export const CLOUD_SHIFT = 9
export const CLOUD_SIZE = 1 << CLOUD_SHIFT
export const CLOUD_MASK = CLOUD_SIZE - 1
export const CLOUD_BASE = 46 // the height the clouds float at
export const CLOUD_LAYERS = 6 // the thickest a cloud gets
export const TOP_Z = CLOUD_BASE + CLOUD_LAYERS // the tallest thing in the world

// The sun is in the north-west. A shadow lands this far east and south per pixel of height.
export const SUN_X = 0.55
export const SUN_Y = 0.4

// A desert. The names are the starter's, so the tools and the drawing code still find them,
// but the meanings are new: the water is a few oasis pools, SAND is the wet sand round them,
// GRASS and TREE are the oasis green and its palms, ROCK is red sandstone, SNOW is the flat
// top of a mesa, and the DUNE materials cover nearly everything else.
export const MAT = {
  DEEP: 0, SEA: 1, SHALLOW: 2, SURF: 3, SAND: 4,
  GRASS: 5, GRASS_DARK: 6, GRASS_LIGHT: 7, TREE: 8, CROWN: 9,
  ROCK: 10, ROCK_DARK: 11, SNOW: 12,
  DUNE: 13, DUNE_LIT: 14, DUNE_DIM: 15,
}
export const WATER_BELOW = MAT.SAND // materials under this index are water

// [top colour, side colour] for each material. The side is what shows on the wall of a stack.
const MATERIALS = [
  [[20, 92, 120], [20, 92, 120]], // oasis water, deepest
  [[28, 120, 144], [28, 120, 144]],
  [[48, 158, 164], [48, 158, 164]],
  [[110, 198, 176], [110, 198, 176]], // the pool's edge
  [[178, 140, 88], [142, 104, 62]], // wet sand
  [[92, 156, 64], [56, 110, 48]], // oasis grass
  [[70, 132, 56], [46, 96, 44]],
  [[128, 184, 78], [62, 122, 50]],
  [[40, 108, 52], [24, 72, 40]], // palm fronds
  [[72, 146, 62], [30, 84, 44]],
  [[196, 118, 74], [150, 78, 52]], // red sandstone
  [[164, 94, 62], [122, 62, 46]],
  [[218, 156, 98], [166, 92, 58]], // the flat top of a mesa
  [[232, 192, 124], [204, 158, 96]], // dunes
  [[248, 216, 150], [214, 172, 108]],
  [[206, 160, 100], [178, 132, 82]],
]

function buildPalette() {
  const count = MATERIALS.length
  const pal = {
    topLit: new Uint32Array(count),
    topShade: new Uint32Array(count),
    sideLit: new Uint32Array(count),
    sideShade: new Uint32Array(count),
    cloudTop: new Uint32Array(CLOUD_LAYERS + 1),
    cloudSide: new Uint32Array(CLOUD_LAYERS + 1),
    cloudUnder: rgb(170, 150, 150),
    haze: rgb(240, 216, 178), // dust in the air: the distance fades to warm sand, not blue
    foam: rgb(206, 240, 218),
    glint: rgb(240, 252, 240),
    sky: new Uint32Array(8),
    trail: [rgb(255, 244, 220), rgb(246, 224, 186), rgb(232, 202, 156)],
  }
  for (let m = 0; m < count; m++) {
    pal.topLit[m] = rgb(...MATERIALS[m][0])
    pal.sideLit[m] = rgb(...MATERIALS[m][1])
    // shadows are cooler as well as darker, so they read as shade and not as dirt
    pal.topShade[m] = tint(pal.topLit[m], 0.6, 0.66, 0.84)
    pal.sideShade[m] = tint(pal.sideLit[m], 0.6, 0.66, 0.84)
  }
  for (let k = 0; k <= CLOUD_LAYERS; k++) {
    const up = k / CLOUD_LAYERS
    const crown = Math.min(1, k / 3)
    pal.cloudTop[k] = rgb(232 + 23 * crown, 226 + 26 * crown, 220 + 26 * crown)
    pal.cloudSide[k] = rgb(196 + 40 * up, 176 + 42 * up, 170 + 40 * up)
  }
  // the sky, from the dusty horizon up to a deep, hot blue
  const low = [246, 222, 184]
  const mid = [150, 196, 228]
  const high = [58, 120, 200]
  for (let i = 0; i < 8; i++) {
    const f = i / 7
    const a = f < 0.5 ? low : mid
    const b = f < 0.5 ? mid : high
    const g = f < 0.5 ? f * 2 : f * 2 - 1
    pal.sky[i] = rgb(a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, a[2] + (b[2] - a[2]) * g)
  }
  return pal
}

/** How much of the map is above water, unless a game asks for something else: almost all of
 * it, so the only water is a few oasis pools in the lowest hollows. */
export const LAND_SHARE = 0.97

/**
 * Builds the world for a seed. `land` is the share of the map that is above water (0..1) and
 * `clouds` is how much cloud there is (0..1).
 */
export function buildWorld(seed = 7, { land = LAND_SHARE, clouds = 0.25 } = {}) {
  const rng = makeRng((seed | 0) * 7919 + 17)
  const heights = new Uint8Array(WORLD_SIZE * WORLD_SIZE)
  const materials = new Uint8Array(WORLD_SIZE * WORLD_SIZE)
  const field = tileableNoise(WORLD_SIZE, [[256, 1], [128, 0.5], [64, 0.25], [32, 0.12], [16, 0.05]], rng)

  // Put the sea level where it leaves the wanted share of land: count how many cells sit at
  // each height, then walk up until enough of them are under water.
  const bins = new Uint32Array(1024)
  for (let i = 0; i < field.length; i++) bins[Math.min(1023, (field[i] * 1024) | 0)]++
  const wet = (1 - Math.min(0.995, Math.max(0.02, land))) * field.length
  let sea = 1
  for (let b = 0, count = 0; b < 1024; b++) {
    count += bins[b]
    if (count >= wet) {
      sea = (b + 1) / 1024
      break
    }
  }

  // Dunes are long ridges with a gentle windward side and a steep slip face. They run across
  // the map a whole number of times, so they wrap with it, and a coarse noise bends them so
  // they are not straight. A second noise decides where they are tall and where they fade
  // into flat sand, and a third raises the mesas.
  const bend = tileableNoise(256, [[64, 1], [32, 0.6], [16, 0.25]], rng)
  const tall = tileableNoise(256, [[128, 1], [64, 0.5]], rng)
  const mesas = tileableNoise(256, [[64, 1], [32, 0.45], [16, 0.15]], rng)
  const OASIS = 0.016 // how far above the water the oasis green reaches
  const span = Math.max(0.05, 1 - sea - OASIS)
  for (let y = 0; y < WORLD_SIZE; y++) {
    const row = y << WORLD_SHIFT
    for (let x = 0; x < WORLD_SIZE; x++) {
      const o = row | x
      const e = field[o] - sea
      const speck = hash2(x, y)
      if (e < 0) {
        const deep = -e + (speck - 128) * 0.00002 // a ragged edge between the bands of blue
        materials[o] = deep > 0.02 ? MAT.DEEP : deep > 0.009 ? MAT.SEA : deep > 0.003 ? MAT.SHALLOW : MAT.SURF
        continue
      }
      if (e < 0.003) {
        materials[o] = MAT.SAND
        continue
      }
      if (e < OASIS) {
        heights[o] = 1
        materials[o] = speck < 40 ? MAT.GRASS_DARK : speck > 200 ? MAT.GRASS_LIGHT : MAT.GRASS
        continue
      }
      const rise = Math.min(1, (e - OASIS) / span) // 0 at the oasis … 1 on the highest ground
      const coarse = ((y >> 2) << 8) | (x >> 2)
      // the ripple: 0 at a trough, rising slowly to a crest, then dropping fast
      const wave = (x * 11 + y * 29) / WORLD_SIZE + bend[coarse] * 6
      const p = wave - Math.floor(wave)
      const ridge = p < 0.72 ? p / 0.72 : (1 - p) / 0.28
      const near = Math.min(1, (e - OASIS) / 0.03) // dunes grow out of the flat sand by the oasis
      const amp = (2 + 9 * Math.max(0, tall[coarse] - 0.25)) * near
      heights[o] = Math.max(1, Math.round(1 + rise * 8 + ridge * amp))
      materials[o] = p > 0.72 ? MAT.DUNE_DIM : p > 0.5 && ridge > 0.85 ? MAT.DUNE_LIT : speck < 14 ? MAT.DUNE_DIM : MAT.DUNE
      // mesas: flat-topped rocks with sheer red sides, in one or two tiers
      const m = mesas[coarse] + (speck - 128) * 0.0002
      if (m > 0.7 && rise > 0.1) {
        heights[o] = m > 0.8 ? 30 : 22
        const rim = (m > 0.7 && m < 0.715) || (m > 0.8 && m < 0.812)
        materials[o] = rim ? MAT.ROCK : MAT.SNOW
      } else if (m > 0.66 && rise > 0.1) {
        // the scree round a mesa's foot
        heights[o] = Math.max(heights[o], Math.round(8 + (m - 0.66) * 150))
        materials[o] = speck < 90 ? MAT.ROCK_DARK : MAT.ROCK
      }
    }
  }

  // Palms: a trunk with a crown of fronds, scattered over the oasis green.
  for (let gy = 0; gy < WORLD_SIZE; gy += 4) {
    for (let gx = 0; gx < WORLD_SIZE; gx += 4) {
      const pick = hash2(gx + 71, gy + 13)
      const x = (gx + (pick & 3)) & WORLD_MASK
      const y = (gy + ((pick >> 2) & 3)) & WORLD_MASK
      const o = (y << WORLD_SHIFT) | x
      const here = materials[o]
      if (here < MAT.GRASS || here > MAT.GRASS_LIGHT) continue
      if (hash2(x + 5, y + 99) > 120) continue
      const base = heights[o]
      const crown = base + 4 + ((pick >> 4) & 1)
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const far = Math.sqrt(dx * dx + dy * dy)
          if (far > 2.3) continue
          const at = (((y + dy) & WORLD_MASK) << WORLD_SHIFT) | ((x + dx) & WORLD_MASK)
          if (materials[at] < MAT.SAND) continue
          const top = crown - Math.round(far * 0.7)
          if (top > heights[at]) {
            heights[at] = top
            materials[at] = far < 1 ? MAT.CROWN : MAT.TREE
          }
        }
      }
    }
  }

  // Start over open desert: try some random spots, look for the tallest ground along twelve
  // rays out to 120 pixels, and keep the spot with the lowest. That keeps mesas out of the
  // first few seconds of flight.
  let spawnX = WORLD_SIZE / 2
  let spawnY = WORLD_SIZE / 2
  let bestTop = Infinity
  for (let tries = 0; tries < 200; tries++) {
    const x = (rng() * WORLD_SIZE) | 0
    const y = (rng() * WORLD_SIZE) | 0
    let top = heights[(y << WORLD_SHIFT) | x]
    for (let ray = 0; ray < 12; ray++) {
      const dx = Math.cos(ray * (Math.PI / 6))
      const dy = Math.sin(ray * (Math.PI / 6))
      for (let far = 10; far <= 120; far += 10) {
        const h = heights[(((y + dy * far) & WORLD_MASK) << WORLD_SHIFT) | ((x + dx * far) & WORLD_MASK)]
        if (h > top) top = h
      }
    }
    if (top < bestTop) {
      bestTop = top
      spawnX = x
      spawnY = y
    }
  }

  // Clouds: each one grows by a short random walk that stamps a dome at every step, so it
  // comes out lumpy instead of round. Each cell holds how many layers thick the cloud is there.
  const cloudMap = new Uint8Array(CLOUD_SIZE * CLOUD_SIZE)
  const count = Math.round(64 * Math.min(1, Math.max(0, clouds)))
  for (let i = 0; i < count; i++) {
    let x = rng() * CLOUD_SIZE
    let y = rng() * CLOUD_SIZE
    let radius = 5 + rng() * 10
    const stamps = 2 + ((rng() * 6) | 0)
    for (let n = 0; n < stamps; n++) {
      const thick = Math.min(CLOUD_LAYERS, Math.max(2, radius * 0.5))
      const reach = Math.ceil(radius)
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const d2 = (dx * dx + dy * dy) / (radius * radius)
          if (d2 > 1) continue
          const layers = Math.max(1, Math.round(Math.sqrt(1 - d2) * thick))
          const at = (((Math.round(y) + dy) & CLOUD_MASK) << CLOUD_SHIFT) | ((Math.round(x) + dx) & CLOUD_MASK)
          if (layers > cloudMap[at]) cloudMap[at] = layers
        }
      }
      // the next dome overlaps this one; clouds stretch further east–west than north–south
      const way = rng() * Math.PI * 2
      x += Math.cos(way) * radius * 0.95
      y += Math.sin(way) * radius * 0.55
      radius = Math.max(3, radius * (0.65 + rng() * 0.5))
    }
  }

  return { seed, heights, materials, cloudMap, spawnX, spawnY, palette: buildPalette() }
}

export function groundAt(world, x, y) {
  return world.heights[(((y | 0) & WORLD_MASK) << WORLD_SHIFT) | ((x | 0) & WORLD_MASK)]
}
