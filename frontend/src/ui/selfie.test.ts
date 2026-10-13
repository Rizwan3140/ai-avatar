import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  arrange, bounds, centreCut, groundOf, clarify, crispness, cutOut, frameFor, grade, isCutOut, meanColour, tone, toneGains, turned, turnFrom,
} from './selfie.ts'

// A 1440x2160 picture; the middle of a 1920x1080 webcam, cut to that shape, is
// 720x1080; and a PNG of the character, head to waist, whose face is 300 tall.
const FRAME = { width: 1440, height: 2160 }
const VIEW = { width: 720, height: 1080 }
const DRAWN = FRAME.width / VIEW.width
const PORTRAIT = { width: 900, height: 1700 }
const THEIR_FACE = { x: 320, y: 140, width: 260, height: 300 }
/** A visitor's face in the camera's picture (not mirrored): this tall, centred
 *  here. Left of the middle there is right of it in the photograph. */
const visitor = (tall: number, cx = 250, cy = 400) => ({
  x: cx - tall * 0.4, y: cy - tall / 2, width: tall * 0.8, height: tall,
})
const theirFaceTall = (placed: ReturnType<typeof arrange>, picture = PORTRAIT) =>
  (THEIR_FACE.height * placed.figure.height) / picture.height

test('the photograph follows the camera, so a webcam is not cut to a strip and blown up', () => {
  // A 1080p webcam: all of its height, three quarters of its width, and not
  // one pixel enlarged. It was a 720-wide strip made 1440.
  assert.deepEqual(frameFor({ width: 1920, height: 1080 }), { width: 1440, height: 1080 })
  // Smaller cameras are brought up to the same size and no further.
  assert.deepEqual(frameFor({ width: 1280, height: 720 }), { width: 1440, height: 1080 })
  assert.deepEqual(frameFor({ width: 640, height: 480 }), { width: 1440, height: 1080 })
  // And a 4K one is not kept at a size nothing here needs.
  assert.deepEqual(frameFor({ width: 3840, height: 2160 }), { width: 2160, height: 1620 })
})

test('a camera stood on its side gives nine by sixteen, all of it and none of it enlarged', () => {
  const upright = turned({ width: 1920, height: 1080 }, 90)
  assert.deepEqual(upright, { width: 1080, height: 1920 })
  assert.deepEqual(frameFor(upright), { width: 1080, height: 1920 })
  assert.deepEqual(centreCut(upright, frameFor(upright)), { x: 0, y: 0, width: 1080, height: 1920 })
  assert.deepEqual(turned({ width: 1920, height: 1080 }, 180), { width: 1920, height: 1080 })
  // Only a turn that is one. Anything else typed into the address is none.
  assert.deepEqual(['90', '270', '180', '45', '', null].map(turnFrom), [90, 270, 180, 0, 0, 0])
})

test('the preview and the photograph are the same cut of the camera', () => {
  assert.deepEqual(centreCut({ width: 1920, height: 1080 }, FRAME), { x: 600, y: 0, width: 720, height: 1080 })
  // A camera stood on its side has more height than the frame wants, not width.
  assert.deepEqual(centreCut({ width: 1080, height: 1920 }, FRAME), { x: 0, y: 150, width: 1080, height: 1620 })
})

test("their face is the size of the visitor's, and level with it", () => {
  for (const tall of [180, 260]) {
    const placed = arrange(FRAME, VIEW, visitor(tall), PORTRAIT, THEIR_FACE)
    const ratio = theirFaceTall(placed) / (tall * DRAWN)
    assert.ok(Math.abs(ratio - 1) < 0.02, `face ratio ${ratio.toFixed(2)} at ${tall}`)
    const theirs = placed.figure.y + ((THEIR_FACE.y + THEIR_FACE.height / 2) * placed.figure.height) / PORTRAIT.height
    assert.ok(Math.abs(theirs - 400 * DRAWN) < 2, `level at ${tall}: ${theirs.toFixed(0)}`)
  }
  const near = arrange(FRAME, VIEW, visitor(260), PORTRAIT, THEIR_FACE)
  const far = arrange(FRAME, VIEW, visitor(110), PORTRAIT, THEIR_FACE)
  assert.ok(near.figure.height > far.figure.height * 1.5, 'closer visitor, larger avatar')
})

test('a picture of them that would end in mid-air is lowered, never enlarged', () => {
  // Head and shoulders only. Level with the visitor at the same size, its cut
  // edge would hang above the bottom: it is moved down, and kept their size.
  const bust = { width: 900, height: 1200 }
  const placed = arrange(FRAME, VIEW, visitor(180), bust, THEIR_FACE)
  const ratio = theirFaceTall(placed, bust) / (180 * DRAWN)
  assert.ok(Math.abs(ratio - 1) < 0.02, `the visitor's size: ${ratio.toFixed(2)}`)
  assert.ok(placed.figure.y + placed.figure.height >= FRAME.height - 1, 'and their edge is the frame edge')
})

test('a wide picture of them is not shrunk to fit: they run off the edge', () => {
  // The real one is a close-up with an arm out. Kept inside the frame it could
  // not grow to match a visitor at a kiosk, and came out two thirds the size.
  const wide = { width: 1400, height: 1500 }
  const face = { x: 620, y: 200, width: 260, height: 300 }
  const placed = arrange(FRAME, VIEW, visitor(260), wide, face)
  assert.ok(Math.abs((face.height * placed.figure.width) / wide.width / (260 * DRAWN) - 1) < 0.02)
  assert.ok(placed.figure.x < 0, 'their arm is off the left of the picture')
})

test('two large faces stand side by side, never one over the other', () => {
  const close = arrange(FRAME, VIEW, visitor(420), PORTRAIT, THEIR_FACE)
  const k = close.figure.width / PORTRAIT.width
  const theirRight = close.figure.x + (THEIR_FACE.x + THEIR_FACE.width) * k
  // The visitor's face, mirrored into the picture.
  const visitorLeft = FRAME.width - (250 + 420 * 0.4) * DRAWN
  assert.ok(theirRight < visitorLeft, `${theirRight.toFixed(0)} < ${visitorLeft.toFixed(0)}`)
})

test('they stand on the side the visitor is not, out to its edge, and never float', () => {
  const placed = arrange(FRAME, VIEW, visitor(200), PORTRAIT, THEIR_FACE)
  assert.ok(placed.figure.x + placed.figure.width / 2 < FRAME.width / 2, 'visitor on the right, avatar on the left')
  assert.ok(placed.figure.x <= 0, 'where their arm is cut is never inside the picture')
  assert.ok(placed.figure.y + placed.figure.height >= FRAME.height - 1, 'their cut edge is the frame edge')
})

test('their side is theirs: a visitor standing anywhere does not move them across', () => {
  // Dead centre, a step either way, and right over on their side of the picture.
  for (const cx of [130, 330, 360, 390, 600]) {
    const placed = arrange(FRAME, VIEW, visitor(180, cx), PORTRAIT, THEIR_FACE)
    assert.ok(placed.figure.x <= 0, `still at the left edge with the visitor at ${cx}`)
    assert.ok(placed.figure.x + placed.figure.width / 2 < FRAME.width / 2, String(cx))
  }
})

test('a character set to the right stands at the right edge, the same way round', () => {
  const left = arrange(FRAME, VIEW, visitor(180, 250), PORTRAIT, THEIR_FACE, 'left')
  // The visitor on the other side of the camera, the character on the right.
  const right = arrange(FRAME, VIEW, visitor(180, 470), PORTRAIT, THEIR_FACE, 'right')
  assert.ok(right.figure.x + right.figure.width >= FRAME.width, 'out to the right-hand edge')
  assert.equal(right.figure.width, left.figure.width, 'the same size as they would be on the left')
  assert.equal('flip' in right, false, 'and never turned round')
  const k = right.figure.width / PORTRAIT.width
  const theirLeft = right.figure.x + THEIR_FACE.x * k
  const visitorRight = FRAME.width - (470 - 180 * 0.4) * DRAWN
  assert.ok(theirLeft > visitorRight, `${theirLeft.toFixed(0)} > ${visitorRight.toFixed(0)}`)
})

test('a visitor standing in their place does not shrink them to fit beside', () => {
  // On the character's own side there is no beside. They stay their size and
  // stand in front; the preview shows it, and the visitor steps aside.
  const inTheWay = arrange(FRAME, VIEW, visitor(180, 600), PORTRAIT, THEIR_FACE)
  const ratio = theirFaceTall(inTheWay) / (180 * DRAWN)
  assert.ok(Math.abs(ratio - 1) < 0.02, `face ratio ${ratio.toFixed(2)}`)
})

test('with no face found anywhere, it is still a picture of two people', () => {
  const blind = arrange(FRAME, VIEW, null, PORTRAIT, null)
  assert.ok(blind.figure.x <= 0, 'on the left, where they stand unless told otherwise')
  assert.ok(blind.figure.height > 0.45 * FRAME.height && blind.figure.height < 1.5 * FRAME.height)
  assert.ok(blind.figure.y + blind.figure.height >= FRAME.height - 1)
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

/** Opaque grey pixels at these brightnesses. */
const greys = (levels: number[]) => {
  const rgba = new Uint8ClampedArray(levels.length * 4)
  levels.forEach((v, i) => rgba.set([v, v, v, 255], i * 4))
  return rgba
}

test('a studio picture is brought toward a webcam’s range, and not all the way', () => {
  // Every sixteenth byte is sampled, so one pixel in four: enough of each.
  const studio = { low: 10, high: 245, colour: 0.5 }
  const webcam = { low: 50, high: 205, colour: 0.25 }
  const rgba = new Uint8ClampedArray([10, 10, 10, 255, 245, 245, 245, 255, 200, 100, 100, 255, 0, 0, 0, 0])
  grade(rgba, studio, webcam, 0.5)
  assert.equal(rgba[0], 30, 'its black, halfway to the lifted one')
  assert.equal(rgba[4], 225, 'its white, halfway to the dulled one')
  assert.ok(rgba[8] - rgba[9] < 100, 'its colour thinner than it was')
  assert.ok(rgba[8] - rgba[9] > 40, 'and still colour')
  assert.deepEqual([...rgba.slice(12)], [0, 0, 0, 0], 'what is transparent is left alone')
})

test('the range of a picture is read from what is there', () => {
  const flat = tone(greys(Array.from({ length: 400 }, (_, i) => 60 + (i % 100))))
  assert.ok(flat.low >= 60 && flat.low <= 66 && flat.high >= 154 && flat.high <= 160, JSON.stringify(flat))
  assert.equal(flat.colour, 0)
  assert.deepEqual(tone(new Uint8ClampedArray(64)), { low: 0, high: 255, colour: 0 })
})

test('a sharp face reads crisper than the same face softened, however contrasty', () => {
  const side = 16
  const stripes = (edge: number, low: number, high: number) =>
    greys(Array.from({ length: side * side }, (_, i) => {
      const x = i % side
      const t = Math.min(1, Math.max(0, (x % 8) / edge))
      return low + (high - low) * (x % 8 < 4 ? t : 1 - Math.min(1, ((x % 8) - 4) / edge))
    }))
  const sharp = crispness(stripes(1, 20, 230), side)
  const soft = crispness(stripes(4, 20, 230), side)
  assert.ok(sharp > soft * 1.5, `${sharp.toFixed(2)} against ${soft.toFixed(2)}`)
  // The same sharp edges at a third of the contrast are still sharp.
  const faint = crispness(stripes(1, 100, 170), side)
  assert.ok(faint > soft, `${faint.toFixed(2)} against ${soft.toFixed(2)}`)
})

test('the camera picture gets its edges back, and its grain is left alone', () => {
  // An edge from 80 to 160, blurred to a ramp either side of it.
  const edge = greys([80, 80, 160, 160])
  clarify(edge, greys([80, 100, 140, 160]), greys([120, 120, 120, 120]), 0, 255)
  assert.ok(edge[4] < 80 && edge[8] > 160, `the two sides pushed apart: ${edge[4]}, ${edge[8]}`)
  assert.ok(edge[8] - edge[4] < 80 + 2 * (0.9 * 20 + 0.3 * 18) + 1, 'and by no more than the halo allows')
  // Two levels of noise on a flat wall are not an edge.
  const wall = greys([120, 122, 120, 122])
  clarify(wall, greys([121, 121, 121, 121]), greys([121, 121, 121, 121]), 0, 255)
  assert.ok(Math.abs(wall[0] - wall[4]) <= 3, `${wall[0]} and ${wall[4]}`)
  // A flat picture is opened out, but a grey wall stays a grey wall.
  const flat = greys([100, 150])
  clarify(flat, greys([100, 150]), greys([100, 150]), 100, 150)
  assert.ok(flat[4] - flat[0] > 50 && flat[4] - flat[0] <= 50 * 4 / 3 + 1 && flat[4] <= 255, `${flat[0]}, ${flat[4]}`)
})

test('a full-length character stands on the visitor\'s floor, eyes level', () => {
  // Their face 300 tall in a picture 1700 tall: head to shoes. The visitor's
  // face is centred at 400 and their feet meet the floor at 1000, in the view.
  const placed = arrange(FRAME, VIEW, visitor(150), PORTRAIT, THEIR_FACE, 'left', 1000)
  const feet = placed.figure.y + placed.figure.height
  assert.ok(Math.abs(feet - 1000 * DRAWN) < 2, `feet on the floor: ${feet.toFixed(0)}`)
  const theirs = placed.figure.y + ((THEIR_FACE.y + THEIR_FACE.height / 2) * placed.figure.height) / PORTRAIT.height
  assert.ok(Math.abs(theirs - 400 * DRAWN) < 2, `eyes level: ${theirs.toFixed(0)}`)
  // A floor misread far away does not make a giant: within a fifth of the face's size.
  const giant = arrange(FRAME, VIEW, visitor(150), PORTRAIT, THEIR_FACE, 'left', 5000)
  assert.ok(theirFaceTall(giant) / (150 * DRAWN) <= 1.251, 'kept near their size')
  // A picture that ends at the waist is not stood on anything.
  const bust = { width: 900, height: 1200 }
  const asBefore = arrange(FRAME, VIEW, visitor(180), bust, THEIR_FACE, 'left', 1000)
  assert.ok(asBefore.figure.y + asBefore.figure.height >= FRAME.height - 1, 'a bust still reaches the bottom')
})

test('the floor is the lowest point of the visitor under their face, if it is in the picture', () => {
  // A 10x20 mask of a 100x200 view; the person is columns 4-6, rows 2-15.
  const mask = new Float32Array(200)
  for (let y = 2; y <= 15; y++) for (let x = 4; x <= 6; x++) mask[y * 10 + x] = 1
  const person = { mask, width: 10, height: 20 }
  const face = { x: 45, y: 25, width: 10, height: 12 }
  assert.equal(groundOf(person, face, { width: 100, height: 200 }), 160)
  // Feet at the bottom edge are the frame cutting them off: no floor.
  for (let y = 16; y < 20; y++) for (let x = 4; x <= 6; x++) mask[y * 10 + x] = 1
  assert.equal(groundOf(person, face, { width: 100, height: 200 }), null)
  // Somebody off to one side is not the visitor's feet.
  const aside = new Float32Array(200)
  for (let y = 2; y <= 15; y++) aside[y * 10 + 0] = 1
  assert.equal(groundOf({ mask: aside, width: 10, height: 20 }, { x: 75, y: 25, width: 10, height: 12 }, { width: 100, height: 200 }), null)
})
