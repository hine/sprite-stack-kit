// Small tools for drawing marks into a picture: dots, boxes, lines, a 3 × 5 pixel font for
// digits and Latin letters, and a 5 × 5 one for the few Japanese characters the saddle shows.
// The cockpit uses them for its dials and its head-up display; a score or a health bar would
// use them the same way.
//
// `to` is anything with { width, height, color }: the framebuffer, or a layer painted once and
// copied in every frame. Everything is clipped, so a mark may run off the edge.

export function dot(to, x, y, col) {
  if (x >= 0 && y >= 0 && x < to.width && y < to.height) to.color[y * to.width + x] = col
}

export function box(to, x, y, w, h, col) {
  const x0 = x < 0 ? 0 : x
  const y0 = y < 0 ? 0 : y
  const x1 = x + w > to.width ? to.width : x + w
  const y1 = y + h > to.height ? to.height : y + h
  for (let row = y0; row < y1; row++) to.color.fill(col, row * to.width + x0, row * to.width + (x1 > x0 ? x1 : x0))
}

export function line(to, x0, y0, x1, y1, col) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
  for (let i = 0; i <= steps; i++) {
    dot(to, Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps), col)
  }
}

/** A filled circle. `col` may be a function (dx, dy) → colour, for shading. */
export function disc(to, cx, cy, radius, col) {
  const shade = typeof col === 'function'
  for (let dy = -Math.ceil(radius); dy <= radius; dy++) {
    for (let dx = -Math.ceil(radius); dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) dot(to, cx + dx, cy + dy, shade ? col(dx, dy) : col)
    }
  }
}

// Fifteen bits per glyph: three across, five down, top row first.
const GLYPHS = new Uint16Array(128)
const SHAPES = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111',
  A: '010101111101101', D: '110101101101110', E: '111100110100111', G: '011100101101011', H: '101101111101101',
  L: '100100100100111', N: '111101101101101', P: '110101110100100', S: '011100010001110', T: '111010010010010',
  W: '101101111111101',
}
for (const char in SHAPES) GLYPHS[char.charCodeAt(0)] = parseInt(SHAPES[char], 2)

// Twenty-five bits per glyph: five across, five down, top row first. Katakana for the labels
// on the read-out.
const WIDE = new Map()
const WIDE_SHAPES = {
  ハ: '01010 01010 10001 10001 10001',
  ヤ: '01000 11111 01001 00100 00100',
  サ: '01010 11111 01010 00010 00100',
  タ: '01000 01111 10101 00010 01100',
  カ: '01000 11111 01001 01001 10110',
  ホ: '00100 11111 00100 10101 00100',
  ウ: '00100 11111 10001 00010 01100',
  イ: '00010 00100 01100 10100 00100',
}
for (const char in WIDE_SHAPES) WIDE.set(char.charCodeAt(0), parseInt(WIDE_SHAPES[char].replaceAll(' ', ''), 2))

/** How wide `count` characters are at this size, without the gap after the last one. */
export const textWidth = (count, size = 1) => (count * 4 - 1) * size
/** … and the same for the 5 × 5 Japanese characters. */
export const wideWidth = (count, size = 1) => (count * 6 - 1) * size

function glyph(to, x, y, code, col, size) {
  const bits = GLYPHS[code]
  for (let n = 0; n < 15; n++) {
    if ((bits >> (14 - n)) & 1) box(to, x + (n % 3) * size, y + ((n / 3) | 0) * size, size, size, col)
  }
}

function wideGlyph(to, x, y, bits, col, size) {
  for (let n = 0; n < 25; n++) {
    if ((bits >> (24 - n)) & 1) box(to, x + (n % 5) * size, y + ((n / 5) | 0) * size, size, size, col)
  }
}

/**
 * Draws a word. Only the letters the saddle needs have shapes; add more to SHAPES, or to
 * WIDE_SHAPES for Japanese. A Japanese character is 5 pixels wide instead of 3.
 */
export function text(to, x, y, word, col, size = 1) {
  for (let i = 0; i < word.length; i++) {
    const code = word.charCodeAt(i)
    const wide = WIDE.get(code)
    if (wide === undefined) {
      glyph(to, x, y, code, col, size)
      x += 4 * size
    } else {
      wideGlyph(to, x, y, wide, col, size)
      x += 6 * size
    }
  }
}

/** Draws a whole number with leading zeros. It builds no string, so it is safe every frame. */
export function number(to, x, y, value, digits, col, size = 1) {
  let rest = Math.max(0, Math.round(value))
  for (let i = digits - 1; i >= 0; i--) {
    glyph(to, x + i * 4 * size, y, 48 + (rest % 10), col, size)
    rest = (rest / 10) | 0
  }
}
