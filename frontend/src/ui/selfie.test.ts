import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arrange, bounds, cutOut, isCutOut, meanColour, toneGains } from './selfie.ts'

// A 1440x2160 picture, a 1920x1080 webcam, and a head-and-shoulders PNG of the
// avatar whose face is 300 pixels tall.
const FRAME = { width: 1440, height: 2160 }
const WEBCAM = { width: 1920, height: 1080 }
const PORTRAIT = { width: 900, height: 1200 }
const THEIR_FACE = { x: 320, y: 140, width: 260, height: 300 }
/** A visitor's face in the webcam frame: this tall, centred here. */
const visitor = (tall: number, cx = 960, cy = 400) => ({
  x: cx - tall * 0.4, y: cy - tall / 2, width: tall * 0.8, height: tall,
})

test('the avatar is sized from the visitor, so neither is a giant beside a doll', () => {
  const near = arrange(FRAME, WEBCAM, visitor(180), PORTRAIT, THEIR_FACE)
  const far = arrange(FRAME, WEBCAM, visitor(110), PORTRAIT, THEIR_FACE)
  assert.ok(near.figure.height > far.figure.height * 1.2, 'closer visitor, larger avatar')
  for (const [tall, placed] of [[180, near], [110, far]] as const) {
    // Their face against the visitor's, as both are drawn: a little larger,
    // being nearer the lens, and never twice the size.
    const scale = placed.room.height / WEBCAM.height
    const ratio = (THEIR_FACE.height * placed.figure.height) / PORTRAIT.height / (tall * scale)
    assert.ok(ratio > 1 && ratio < 1.4, `face ratio ${ratio.toFixed(2)} at ${tall}`)
  }
})

test('a visitor filling the frame is not given an avatar that covers them', () => {
  // Matching a face this close would make them wider than the picture. They
  // stop at nine tenths of it, and the visitor is simply the larger of the two.
  const close = arrange(FRAME, WEBCAM, visitor(420), PORTRAIT, THEIR_FACE)
  assert.ok(close.figure.width <= 0.9 * FRAME.width + 1)
})

test('somebody across the room is brought nearer, but only so far', () => {
  const tiny = arrange(FRAME, WEBCAM, visitor(40), PORTRAIT, THEIR_FACE)
  assert.ok(tiny.room.height > FRAME.height, 'the camera picture is enlarged toward them')
  assert.ok(tiny.room.height <= FRAME.height * 1.5 + 1, 'and no more than half again')
  assert.ok(tiny.figure.height >= 0.45 * FRAME.height - 1, 'and the avatar is never a doll')
})

test('they stand on the side the visitor is not, and never float', () => {
  const placed = arrange(FRAME, WEBCAM, visitor(200), PORTRAIT, THEIR_FACE)
  const middle = placed.figure.x + placed.figure.width / 2
  assert.ok(middle < FRAME.width / 2, 'visitor slid to the right, avatar on the left')
  assert.ok(placed.figure.y + placed.figure.height >= FRAME.height - 1, 'their cut edge is the frame edge')
  // The room still covers the whole frame after being slid.
  assert.ok(placed.room.x <= 0 && placed.room.x + placed.room.width >= FRAME.width - 1)
  assert.ok(placed.room.y <= 0 && placed.room.y + placed.room.height >= FRAME.height - 1)
})

test('with no face found anywhere, it is still a picture of two people', () => {
  const blind = arrange(FRAME, WEBCAM, null, PORTRAIT, null)
  assert.ok(blind.figure.height > 0.45 * FRAME.height && blind.figure.height < 1.5 * FRAME.height + 1)
  assert.ok(blind.figure.width <= 0.9 * FRAME.width + 1)
  assert.ok(blind.room.x <= 0 && blind.room.x + blind.room.width >= FRAME.width - 1)
})

test('a picture that arrives cut out is not cut again', () => {
  const opaque = new Uint8ClampedArray(64 * 100).fill(255)
  assert.equal(isCutOut(opaque), false)
  const cut = new Uint8ClampedArray(64 * 100).fill(255)
  for (let i = 3; i < cut.length / 2; i += 4) cut[i] = 0
  assert.equal(isCutOut(cut), true)
})

/** A frame from rows of characters: `.` studio white, `#` dark, `w` white
 *  clothing — the same white as the studio, which is the whole difficulty. */
function frame(rows: string[]) {
  const width = rows[0].length
  const rgba = new Uint8ClampedArray(width * rows.length * 4)
  rows.join('').split('').forEach((cell, i) => {
    const value = cell === '#' ? 40 : 254
    rgba.set([value, value, value, 255], i * 4)
  })
  return { rgba, width, height: rows.length }
}

const alpha = (rgba: Uint8ClampedArray, width: number, x: number, y: number) =>
  rgba[(y * width + x) * 4 + 3]

test('the studio white goes, and a white shirt inside a jacket stays', () => {
  const { rgba, width, height } = frame([
    '.......',
    '.#####.',
    '.#www#.',
    '.#www#.',
    '.#####.',
    '.#####.',
  ])
  cutOut(rgba, width, height)
  assert.equal(alpha(rgba, width, 0, 0), 0, 'the corner is background')
  assert.equal(alpha(rgba, width, 6, 3), 0, 'so is the side')
  assert.equal(alpha(rgba, width, 3, 2), 255, 'the shirt is enclosed, so it is kept')
  assert.equal(alpha(rgba, width, 1, 1), 150, 'the outline is feathered')
  assert.equal(alpha(rgba, width, 2, 4), 255, 'the body is untouched')
})

test('pale trousers running off the bottom are not eaten from the floor', () => {
  const { rgba, width, height } = frame([
    '.....',
    '.###.',
    '#www#',
    '#www#',
  ])
  cutOut(rgba, width, height)
  assert.equal(alpha(rgba, width, 2, 3), 255)
  assert.equal(alpha(rgba, width, 0, 0), 0)
})

test('a grey backdrop goes too, and skin beside it does not', () => {
  // The footage is not on white: one backdrop runs 180 to 210, colourless.
  const width = 4
  const rgba = new Uint8ClampedArray(width * 2 * 4)
  const row = [[186, 184, 179], [200, 200, 198], [228, 190, 170], [209, 211, 211]]
  for (const y of [0, 1]) row.forEach((c, x) => rgba.set([...c, 255], (y * width + x) * 4))
  cutOut(rgba, width, 2)
  assert.equal(alpha(rgba, width, 0, 0), 0)
  assert.equal(alpha(rgba, width, 1, 1), 0)
  assert.notEqual(alpha(rgba, width, 2, 0), 0, 'pale skin has colour, so it is not backdrop')
})

test('the backdrop in the crook of an arm goes, though nothing connects it to the edge', () => {
  const rows = Array.from({ length: 12 }, () => '.##########.')
  rows[0] = rows[11] = '............'
  rows[5] = '.####w#####.'
  const { rgba, width, height } = frame(rows)
  cutOut(rgba, width, height)
  assert.equal(alpha(rgba, width, 5, 5), 0, 'one pixel of 144 is a gap, not a garment')
  assert.equal(alpha(rgba, width, 5, 6), 150, 'and the arm around it is feathered')
})

test('the box is drawn round what is left', () => {
  const { rgba, width, height } = frame(['.....', '..##.', '..##.', '.....'])
  cutOut(rgba, width, height)
  assert.deepEqual(bounds(rgba, width, height), { x: 2, y: 1, width: 2, height: 2 })
  const empty = frame(['...', '...'])
  cutOut(empty.rgba, empty.width, empty.height)
  assert.equal(bounds(empty.rgba, empty.width, empty.height), null)
})

test('removed pixels do not count toward the average colour', () => {
  assert.deepEqual(meanColour(new Uint8ClampedArray([40, 50, 60, 255])), [40, 50, 60])
  assert.deepEqual(meanColour(new Uint8ClampedArray([9, 9, 9, 0])), [128, 128, 128])
})

test('the avatar leans toward the room, and only so far', () => {
  assert.deepEqual(toneGains([120, 120, 120], [120, 120, 120]), [1, 1, 1])
  const [r, , b] = toneGains([200, 150, 90], [130, 130, 130])
  assert.ok(r > 1 && b < 1, 'a warm room warms them')
  // A black room must not turn them into a silhouette.
  for (const gain of toneGains([4, 30, 6], [220, 200, 190])) {
    assert.ok(gain >= 0.86 * 0.88 && gain <= 1.1 * 1.14, String(gain))
  }
})
