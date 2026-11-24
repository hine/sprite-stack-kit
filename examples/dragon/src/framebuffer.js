// The whole game is drawn into one small picture: an array with one 32-bit number per pixel.
// The page then shows that picture scaled up by a whole number, with hard edges.
//
// Colours are packed as 0xAABBGGRR, which is the byte order ImageData wants on every
// little-endian device (every phone, laptop and desktop in use today). A pixel that is exactly
// 0 has not been drawn yet; every real colour has full alpha, so it is never 0.

export const EMPTY = 0
export const FAR = 1e9

export const rgb = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0

/** `color` with each channel scaled (factors 0..1): shadows and darker tones. */
export function tint(color, red, green, blue) {
  return rgb(((color & 255) * red) | 0, (((color >> 8) & 255) * green) | 0, (((color >> 16) & 255) * blue) | 0)
}

/** `a` moved `amount`/256 of the way to `b`. */
export function mix(a, b, amount) {
  const keep = 256 - amount
  return (
    ((255 << 24) |
      (((((a >> 16) & 255) * keep + ((b >> 16) & 255) * amount) >> 8) << 16) |
      (((((a >> 8) & 255) * keep + ((b >> 8) & 255) * amount) >> 8) << 8) |
      (((a & 255) * keep + (b & 255) * amount) >> 8)) >>> 0
  )
}

/**
 * 4×4 ordered-dither thresholds, 0..15. To show something at a strength of 0..1 without
 * blending, draw only the pixels where `strength * 16 > BAYER4[((y & 3) << 2) | (x & 3)]`.
 */
export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

export function createFramebuffer() {
  return {
    width: 0,
    height: 0,
    /** what is shown: one packed colour per pixel */
    color: new Uint32Array(0),
    /** how far into the view the surface at each pixel is, so near things can hide far ones */
    depth: new Float32Array(0),
    /** scratch for the sprite being drawn: which pixels it has touched */
    mask: new Uint8Array(0),
    /** the same memory as `color`, as bytes, which is what ImageData wants */
    bytes: new Uint8ClampedArray(0),
    resize(width, height) {
      this.width = Math.max(8, width | 0)
      this.height = Math.max(8, height | 0)
      const memory = new ArrayBuffer(this.width * this.height * 4)
      this.color = new Uint32Array(memory)
      this.bytes = new Uint8ClampedArray(memory)
      this.depth = new Float32Array(this.width * this.height)
      this.mask = new Uint8Array(this.width * this.height)
    },
    clear() {
      // Only the part in use: roll.js draws on a sheet that is often smaller than its memory.
      const used = this.width * this.height
      this.color.fill(EMPTY, 0, used)
      this.depth.fill(FAR, 0, used)
    },
  }
}
