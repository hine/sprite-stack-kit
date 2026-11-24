// Seeded randomness. A game built on this kit takes one seed and derives everything from it,
// so a world can be shared as a number and a bug can be replayed exactly.

/** mulberry32: a tiny, fast generator. Returns a function that gives 0 ≤ n < 1. */
export function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Hash of two integers → 0..255. Gives every cell its own "random" number with nothing stored. */
export function hash2(x, y) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return h & 255
}

const smooth = (t) => t * t * (3 - 2 * t)

/**
 * Value noise that tiles: the left edge matches the right and the top matches the bottom, so a
 * map made from it can wrap for ever. `octaves` is a list of [cell size, strength]; every cell
 * size must divide `size`. Returns size × size numbers scaled to 0..1.
 */
export function tileableNoise(size, octaves, rng) {
  const field = new Float32Array(size * size)
  const lo = new Int32Array(size)
  const hi = new Int32Array(size)
  const part = new Float32Array(size)
  for (const [cell, strength] of octaves) {
    const n = size / cell
    const lattice = new Float32Array(n * n)
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng()
    for (let x = 0; x < size; x++) {
      const g = x / cell
      const i = Math.floor(g)
      lo[x] = i % n
      hi[x] = (i + 1) % n
      part[x] = smooth(g - i)
    }
    for (let y = 0; y < size; y++) {
      const rowA = lo[y] * n
      const rowB = hi[y] * n
      const fy = part[y]
      const row = y * size
      for (let x = 0; x < size; x++) {
        const a = lattice[rowA + lo[x]]
        const b = lattice[rowB + lo[x]]
        const top = a + (lattice[rowA + hi[x]] - a) * part[x]
        const bottom = b + (lattice[rowB + hi[x]] - b) * part[x]
        field[row + x] += strength * (top + (bottom - top) * fy)
      }
    }
  }
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < field.length; i++) {
    if (field[i] < min) min = field[i]
    if (field[i] > max) max = field[i]
  }
  const scale = 1 / (max - min || 1)
  for (let i = 0; i < field.length; i++) field[i] = (field[i] - min) * scale
  return field
}
