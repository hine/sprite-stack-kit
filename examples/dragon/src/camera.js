// One camera for every view.
//
// A point in the world lands on screen at
//
//   scale = zoom / (1 + persp × depth)
//   x     = cx + scale × across
//   y     = cy − scale × (height + tilt × depth)
//
// `across` and `depth` are the point's position relative to the camera's focus, measured
// across the screen and into it; `height` is how far it is above the focus.
//
// With persp = 0 and tilt = 1 this is the classic sprite-stack picture: nothing shrinks with
// distance, and each layer of a stack sits exactly one pixel above the layer below it.
// Raising persp brings the eye in close behind the focus: far things shrink and a horizon
// appears. A view change only slides these few numbers, so there is never a cut.
//
// World axes: x runs east, y runs south (down the map), z is up. A heading of 0 points north
// and grows clockwise.

const NEAR = 0.12

export function createCamera() {
  return {
    // the focus: the world point that sits at (cx, cy) on screen
    x: 0,
    y: 0,
    alt: 0,
    heading: 0, // the compass direction that points up the screen, radians
    persp: 0, // 1 ÷ the distance from the eye to the focus; 0 is the flat view
    tilt: 1, // tan of how steeply the eye looks down; 1 is 45°
    zoom: 1, // screen pixels per world pixel at the focus
    cx: 0,
    cy: 0,
    sin: 0,
    cos: 1,
    // what project() found
    sx: 0,
    sy: 0,
    scale: 0,
    depth: 0,
  }
}

/** World point → cam.sx, cam.sy, with cam.scale and cam.depth. False when it is behind the eye. */
export function project(cam, x, y, z) {
  const dx = x - cam.x
  const dy = y - cam.y
  const depth = dx * cam.sin - dy * cam.cos
  const den = 1 + cam.persp * depth
  if (den < NEAR) return false
  const scale = cam.zoom / den
  cam.depth = depth
  cam.scale = scale
  cam.sx = cam.cx + scale * (dx * cam.cos + dy * cam.sin)
  cam.sy = cam.cy - scale * (z - cam.alt + cam.tilt * depth)
  return true
}

/** The screen row of the horizon, or far above the frame in the flat view. */
export function horizonRow(cam) {
  return cam.persp > 1e-7 ? cam.cy - (cam.zoom * cam.tilt) / cam.persp : -1e9
}

/** How high the eye is. Infinite in the flat view, where there is no eye point. */
export function eyeHeight(cam) {
  return cam.persp > 1e-7 ? cam.alt + cam.tilt / cam.persp : Infinity
}

/**
 * Sets the camera to a mix of three poses. `chase` and `cockpit` are how much of each of
 * those poses is in the mix, 0..1; whatever is left over is the overhead pose. `look`,
 * `heading` and `tilt` are mixed by the game, because they follow the craft.
 *
 *              overhead     chase                    cockpit
 *   persp      0            1 ÷ chaseDistance        1 ÷ cockpitLook
 *   zoom       1            craft fills chaseWidth   lens ÷ cockpitLook
 *   anchor     the middle   a little below it        a little above it
 */
export function aimCamera(cam, chase, cockpit, look, heading, tilt, width, height, tune) {
  cam.x = look.x
  cam.y = look.y
  cam.alt = look.alt
  cam.heading = heading
  cam.sin = Math.sin(heading)
  cam.cos = Math.cos(heading)
  cam.persp = chase / tune.chaseDistance + cockpit / tune.cockpitLook
  cam.tilt = tilt
  // Zoom slides geometrically, so things grow at an even rate all the way through a move.
  const chaseZoom = Math.max(1, (tune.chaseWidth * width) / tune.craftWidth)
  const cockpitZoom = Math.max(1, (tune.cockpitLens * Math.max(width, height)) / tune.cockpitLook)
  cam.zoom = Math.exp(chase * Math.log(chaseZoom) + cockpit * Math.log(cockpitZoom))
  cam.cx = width >> 1
  cam.cy = Math.round(height * (0.5 + 0.13 * chase - 0.12 * cockpit))
}

/** How far in front of the eye a point is, after project(). Infinite in the flat view. */
export function eyeDistance(cam) {
  return cam.persp > 1e-7 ? cam.depth + 1 / cam.persp : Infinity
}
