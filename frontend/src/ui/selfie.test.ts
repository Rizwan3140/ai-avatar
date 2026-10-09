import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bounds, cutOut, meanColour, toneGains } from './selfie.ts'

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
