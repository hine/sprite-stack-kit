// The page: fits the canvas, passes input to the game, and shows each frame.

import { createGame } from './game.js'

// ?seed=3 picks the world, and ?view=chase or ?view=cockpit picks the view to start in
const query = new URLSearchParams(location.search)
const game = createGame({
  seed: Number(query.get('seed')) || 7,
  view: query.get('view') ?? 'top',
})
const canvas = document.getElementById('game')
const ctx = canvas.getContext('2d')
const hint = document.getElementById('hint')
const viewButton = document.getElementById('view')

const touch = matchMedia('(pointer: coarse)').matches
const HINTS = touch
  ? {
      top: 'ドラッグで操縦 · タップで回転 · 長押しで火を吐く · 「視点」で後ろからの視点へ',
      chase: 'ドラッグで操縦と上昇・下降 · タップで回転 · 長押しで火を吐く · 「視点」で鞍の視点へ',
      cockpit: 'ドラッグで操縦と上昇・下降 · 「視点」で上からの視点へ',
    }
  : {
      top: 'マウスで操縦 · クリックで回転 · 長押しで火を吐く · W/S で上昇・下降 · スペースで後ろからの視点へ · E で重ねた板を分解',
      chase: 'マウスの位置で操縦と上昇・下降 · クリックで回転 · 長押しで火を吐く · スペースで鞍の視点へ',
      cockpit: 'マウスの位置で操縦と上昇・下降 · クリックで回転 · 長押しで火を吐く · スペースで上からの視点へ',
    }

let pixel = 3 // screen pixels per game pixel
let image = null
let shownView = ''

function fit() {
  // A whole number of screen pixels per game pixel, chosen so the picture is about 400 wide.
  pixel = Math.max(2, Math.min(8, Math.round(Math.min(innerWidth / 400, innerHeight / 250))))
  const width = Math.ceil(innerWidth / pixel)
  const height = Math.ceil(innerHeight / pixel)
  canvas.width = width
  canvas.height = height
  canvas.style.width = width * pixel + 'px'
  canvas.style.height = height * pixel + 'px'
  game.resize(width, height)
  // The ImageData wraps the game's own memory, so showing a frame copies nothing extra.
  image = new ImageData(game.frame.bytes, game.frame.width, game.frame.height)
}

let last = 0
function tick(now) {
  const dt = last ? (now - last) / 1000 : 0
  last = now
  game.update(dt)
  game.render()
  ctx.putImageData(image, 0, 0)
  if (game.view !== shownView) {
    shownView = game.view
    hint.textContent = HINTS[shownView]
    hint.classList.toggle('high', shownView === 'cockpit')
  }
  requestAnimationFrame(tick)
}

// ── pointer: mouse, pen and touch all arrive as pointer events
canvas.addEventListener('pointermove', (e) => game.pointerMove(e.clientX / pixel, e.clientY / pixel))
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  canvas.setPointerCapture(e.pointerId)
  game.pointerMove(e.clientX / pixel, e.clientY / pixel)
  game.press()
})
canvas.addEventListener('pointerup', () => game.release())
canvas.addEventListener('pointercancel', () => game.pointerLeave())
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse') game.pointerLeave()
})
canvas.addEventListener('contextmenu', (e) => e.preventDefault())
viewButton.addEventListener('click', () => game.nextView())

// ── keys
const held = new Set()
const down = (...codes) => codes.some((code) => held.has(code))
function sendKeys() {
  game.setKeys(
    (down('ArrowRight', 'KeyD') ? 1 : 0) - (down('ArrowLeft', 'KeyA') ? 1 : 0),
    (down('ArrowUp', 'KeyW') ? 1 : 0) - (down('ArrowDown', 'KeyS') ? 1 : 0),
    down('ShiftLeft', 'ShiftRight'),
  )
}
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.code === 'Space') {
    e.preventDefault()
    if (!e.repeat) game.nextView()
  } else if (e.code === 'KeyE') {
    if (!e.repeat) game.toggleSpread()
  } else if (e.code === 'KeyR') {
    if (!e.repeat) game.roll()
  } else {
    if (e.code.startsWith('Arrow')) e.preventDefault()
    held.add(e.code)
    sendKeys()
  }
})
addEventListener('keyup', (e) => {
  held.delete(e.code)
  sendKeys()
})
addEventListener('blur', () => {
  held.clear()
  sendKeys()
  game.pointerLeave()
})
addEventListener('resize', fit)

fit()
requestAnimationFrame(tick)
