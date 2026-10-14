import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HERO, NEARER, OVERLAP, castOf, finish, feetCut, headEdge, reachOf, FACE_CM, arrange, heightOf, statureOf, bodyOf, bounds, lightGain, regionOf, centreCut, fitBodies, clarify, crispness, cutOut, frameFor, grade, isCutOut, meanColour, tone, toneGains, turned, turnFrom, cameraTurn,
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
  // Mounted as this cabinet's is, unless the machine has been told otherwise;
  // told once, it remembers.
  const kept = new Map<string, string>()
  const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) }
  assert.equal(cameraTurn({ search: '', storage }), 270)
  assert.equal(cameraTurn({ search: '?turn=0', storage }), 0)
  assert.equal(cameraTurn({ search: '', storage }), 0)
  // Only a turn that is one. Anything else typed into the address is none.
  assert.deepEqual(['90', '270', '180', '45', '', null].map(turnFrom), [90, 270, 180, 0, 0, 0])
})

test('the preview and the photograph are the same cut of the camera', () => {
  assert.deepEqual(centreCut({ width: 1920, height: 1080 }, FRAME), { x: 600, y: 0, width: 720, height: 1080 })
  // A camera stood on its side has more height than the frame wants, not width.
  assert.deepEqual(centreCut({ width: 1080, height: 1920 }, FRAME), { x: 0, y: 150, width: 1080, height: 1620 })
})

test("their face is the visitor's, a step nearer the camera, their eyes a little higher", () => {
  // Low enough in the picture that their hair stays inside it (see "never
  // leaves the frame").
  for (const tall of [180, 260]) {
    const placed = arrange(FRAME, VIEW, visitor(tall, 250, 520), PORTRAIT, THEIR_FACE)
    const ratio = theirFaceTall(placed) / (tall * DRAWN)
    assert.ok(Math.abs(ratio - NEARER) < 0.02, `face ratio ${ratio.toFixed(2)} at ${tall}`)
    const theirs = placed.figure.y + ((THEIR_FACE.y + THEIR_FACE.height / 2) * placed.figure.height) / PORTRAIT.height
    const lift = 520 * DRAWN - theirs
    assert.ok(lift > 0 && lift < tall * DRAWN, `a little higher at ${tall}: ${lift.toFixed(0)}`)
  }
  const near = arrange(FRAME, VIEW, visitor(260), PORTRAIT, THEIR_FACE)
  const far = arrange(FRAME, VIEW, visitor(110), PORTRAIT, THEIR_FACE)
  assert.ok(near.figure.height > far.figure.height * 1.5, 'closer visitor, larger avatar')
})

test('a picture of them that would end in mid-air is lowered, not enlarged further', () => {
  // Head and shoulders only. Its cut edge would hang above the bottom: it is
  // moved down, and kept at the size it was given.
  const bust = { width: 900, height: 1200 }
  const placed = arrange(FRAME, VIEW, visitor(180), bust, THEIR_FACE)
  const ratio = theirFaceTall(placed, bust) / (180 * DRAWN)
  assert.ok(Math.abs(ratio - NEARER) < 0.02, `their size: ${ratio.toFixed(2)}`)
  assert.ok(placed.figure.y + placed.figure.height >= FRAME.height - 1, 'and their edge is the frame edge')
})

test('a wide picture of them is not shrunk to fit: they run off the edge', () => {
  // The real one is a close-up with an arm out. Kept inside the frame it could
  // not grow to match a visitor at a kiosk, and came out two thirds the size.
  const wide = { width: 1400, height: 1500 }
  const face = { x: 620, y: 200, width: 260, height: 300 }
  const placed = arrange(FRAME, VIEW, visitor(260, 250, 600), wide, face)
  assert.ok(Math.abs((face.height * placed.figure.width) / wide.width / (260 * DRAWN) - NEARER) < 0.02)
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
  assert.ok(Math.abs(ratio - NEARER) < 0.02, `face ratio ${ratio.toFixed(2)}`)
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

test('the character is fitted to the visitor\'s body, then stands a step nearer', () => {
  // Their picture, 1700 tall, head to shoes. The visitor is seen to the knees.
  const figure = { nose: 290, shoulders: 500, hips: 900, knees: 1250, ankles: 1600 }
  const visitorBody = { nose: 400, shoulders: 520, hips: 760, knees: 1000, ankles: null }
  const placed = arrange(FRAME, VIEW, visitor(180), PORTRAIT, THEIR_FACE, 'left', { visitor: visitorBody, figure })
  const k = placed.figure.height / PORTRAIT.height
  // Sized nose to knees on the visitor, then nearer.
  assert.ok(Math.abs(k - ((1000 - 400) / (1250 - 290)) * DRAWN * NEARER) < 0.001, `scale ${k.toFixed(3)}`)
  // Nearer the camera, so the frame cuts them higher up the leg than the visitor.
  const at = (mark: number) => placed.figure.y + mark * k
  assert.ok(at(figure.knees) > 1000 * DRAWN, 'their knees below the visitor\'s')
  assert.ok(at(figure.nose) < 400 * DRAWN, 'their head a little higher')
  // Seen to the shoes: nearer, their shoes are lower than the visitor's, never lifted.
  const whole = { ...visitorBody, knees: 900, ankles: 1020 }
  const standing = arrange(FRAME, VIEW, visitor(180), PORTRAIT, THEIR_FACE, 'left', { visitor: whole, figure })
  const k2 = standing.figure.height / PORTRAIT.height
  assert.ok(standing.figure.y + figure.ankles * k2 >= 1020 * DRAWN, 'shoes at or below the visitor\'s')
})

test('the character stands shoulder to shoulder with the visitor, no gap', () => {
  // A visitor just right of the middle of the photograph, and a little further.
  for (const cx of [300, 330, 360]) {
    const placed = arrange(FRAME, VIEW, visitor(180, cx), PORTRAIT, THEIR_FACE)
    const k = placed.figure.width / PORTRAIT.width
    const theirFace = placed.figure.x + (THEIR_FACE.x + THEIR_FACE.width / 2) * k
    const theirShoulder = theirFace + 1.3 * THEIR_FACE.width * k
    const headX = FRAME.width - cx * DRAWN
    const visitorShoulder = headX - 1.2 * 180 * 0.8 * DRAWN
    const gap = visitorShoulder - theirShoulder
    // Touching, theirs a little in front - unless the picture could not follow.
    assert.ok(gap <= 0.5 * THEIR_FACE.width * k || placed.apart, `${cx}: gap ${gap.toFixed(0)}`)
    // Not laid over the visitor - unless, larger than them beside a visitor in
    // the middle, their face is already as near their own edge as it goes.
    const pinned = theirFace <= (THEIR_FACE.width * k) / 2 + 0.02 * FRAME.width + 1
    assert.ok(gap > -0.5 * THEIR_FACE.width * k || pinned, `${cx}: not laid over the visitor: ${gap.toFixed(0)}`)
    // And never over the visitor's face.
    assert.ok(theirFace + (THEIR_FACE.width / 2) * k < headX - 180 * 0.4 * DRAWN, `${cx}: faces apart`)
  }
  // A visitor right over at the far side: as close as the picture allows, and told to step in.
  assert.equal(arrange(FRAME, VIEW, visitor(120, 40), PORTRAIT, THEIR_FACE).apart, true)
})

test('the character is brought down to the visitor\'s light, never up', () => {
  assert.equal(lightGain(200, 250), 0.8)
  assert.equal(lightGain(250, 200), 1)
  assert.equal(lightGain(100, 250), 0.7)
  // A region of a 4x2 picture, the right half.
  const rgba = new Uint8ClampedArray(4 * 2 * 4).map((_, i) => i)
  assert.deepEqual([...regionOf(rgba, 4, { x: 2, y: 0, width: 2, height: 2 })], [8, 9, 10, 11, 12, 13, 14, 15, 24, 25, 26, 27, 28, 29, 30, 31])
})

test('a misread body does not make a giant, and no body leaves the face to decide', () => {
  const figure = { nose: 290, shoulders: 500, hips: 900, knees: 1250, ankles: 1600 }
  const wild = { nose: 400, shoulders: null, hips: null, knees: null, ankles: 5000 }
  const placed = arrange(FRAME, VIEW, visitor(180), PORTRAIT, THEIR_FACE, 'left', { visitor: wild, figure })
  assert.ok(theirFaceTall(placed) / (180 * DRAWN) <= 1.601 * NEARER, 'within 40% of the face, then nearer')
  const byFace = arrange(FRAME, VIEW, visitor(180), PORTRAIT, THEIR_FACE)
  const noBody = { nose: null, shoulders: null, hips: null, knees: null, ankles: null }
  assert.deepEqual(arrange(FRAME, VIEW, visitor(180), PORTRAIT, THEIR_FACE, 'left', { visitor: noBody, figure }), byFace)
  assert.equal(fitBodies(noBody, figure), null)
})

test('a body mark counts when it is seen and inside the picture', () => {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }))
  points[0] = { x: 0.5, y: 0.1, visibility: 0.99 } // nose
  points[25] = { x: 0.45, y: 0.8, visibility: 0.9 } // one knee seen
  points[26] = { x: 0.55, y: 0.82, visibility: 0.2 } // the other not
  points[27] = { x: 0.45, y: 1.1, visibility: 0.9 } // ankles below the frame
  points[28] = { x: 0.55, y: 0.99, visibility: 0.9 }
  const body = bodyOf(points, 1000)
  assert.equal(body.nose, 100)
  assert.equal(body.knees, 800)
  assert.equal(body.ankles, null)
})

test('a body\'s height and floor come from its nose and its lowest mark', () => {
  const whole = statureOf({ nose: 100, shoulders: 200, hips: 560, knees: 820, ankles: 1000 })!
  assert.ok(Math.abs(whole.tall - 900 / (0.91 - 0.039)) < 0.01 && Math.abs(whole.floor - (100 + 0.91 * whole.tall)) < 0.01)
  // Seen to the knees, the floor is below the picture.
  const kneed = statureOf({ nose: 100, shoulders: 200, hips: 560, knees: 820, ankles: null })!
  assert.ok(kneed.floor > 820)
  assert.equal(statureOf({ nose: 100, shoulders: 200, hips: null, knees: null, ankles: null }), null)
  // A visitor 12 faces tall is 12 face-heights of centimetres tall.
  const body = { nose: 0, shoulders: null, hips: null, knees: null, ankles: 0.871 * 960 }
  assert.ok(Math.abs(heightOf(body, 80)! - 12 * FACE_CM) < 0.01)
  assert.equal(heightOf(body, null), null)
  // The man `FACE_CM` was fitted to, 175 cm, as this cabinet's camera saw him
  // (his face measured at one size, and MediaPipe's marks): to his shoes, cut
  // at the knees, and cut at the hips. Each within 10 cm of him.
  const him = [
    { ruler: 127, body: { nose: 764, shoulders: null, hips: 1377, knees: 1674, ankles: 1924 } },
    { ruler: 171, body: { nose: 638, shoulders: null, hips: 1466, knees: 1874, ankles: null } },
    { ruler: 177, body: { nose: 85, shoulders: null, hips: 941, knees: null, ankles: null } },
  ]
  for (const { ruler, body } of him) {
    const cm = heightOf(body, ruler)!
    assert.ok(Math.abs(cm - 175) < 10, `${body.ankles ? 'shoes' : body.knees ? 'knees' : 'hips'}: ${cm.toFixed(0)} cm`)
  }
})

test('given their real height, the character stands on the visitor\'s floor, that much taller and a little more', () => {
  // A character head to shoes, a face 150 tall in a picture 1700 tall.
  const face = { x: 375, y: 140, width: 150, height: 150 }
  const figure = { nose: 290, shoulders: 420, hips: 900, knees: 1250, ankles: 1600 }
  // A visitor seen to the knees, estimated at 170 cm, their face 120 tall.
  // Low enough in the picture that the taller of them stays inside it.
  const visitorBody = { nose: 560, shoulders: 630, hips: null, knees: 560 + 0.68 * 960, ankles: null }
  const seen = { x: 210, y: 500, width: 96, height: 120 }
  const visitorTall = statureOf(visitorBody)!
  const figureTall = statureOf(figure)!
  for (const tall of [180, 200]) {
    const placed = arrange(FRAME, VIEW, seen, PORTRAIT, face, 'left', { visitor: visitorBody, figure }, tall, 170)
    const k = placed.figure.height / PORTRAIT.height
    const ratio = (figureTall.tall * k) / (visitorTall.tall * DRAWN)
    assert.ok(Math.abs(ratio - (tall / 170) * HERO) < 0.01, `${tall} cm: ${ratio.toFixed(3)}`)
    const floor = placed.figure.y + figureTall.floor * k
    assert.ok(Math.abs(floor - visitorTall.floor * DRAWN) < 2, `${tall} cm: on one floor`)
  }
  // A wild estimate is held to a fifth: never a giant.
  const giant = arrange(FRAME, VIEW, seen, PORTRAIT, face, 'left', { visitor: visitorBody, figure }, 250, 170)
  const kg = giant.figure.height / PORTRAIT.height
  assert.ok((figureTall.tall * kg) / (visitorTall.tall * DRAWN) <= 1.2 * HERO + 0.001)
  // No height given, or none estimated: a step nearer, as before.
  const asBefore = arrange(FRAME, VIEW, seen, PORTRAIT, face, 'left', { visitor: visitorBody, figure })
  assert.deepEqual(arrange(FRAME, VIEW, seen, PORTRAIT, face, 'left', { visitor: visitorBody, figure }, null, 170), asBefore)
  assert.deepEqual(arrange(FRAME, VIEW, seen, PORTRAIT, face, 'left', { visitor: visitorBody, figure }, 188, null), asBefore)
  assert.ok(NEARER > HERO)
})

test('stood by height, they are never drawn over the visitor\'s face, and never float', () => {
  const face = { x: 375, y: 140, width: 150, height: 150 }
  // A tall star beside a visitor close to the lens with little room on the
  // character's side: their real difference would put one face over the other.
  const figure = { nose: 290, shoulders: 420, hips: 900, knees: 1250, ankles: 1600 }
  const near = { x: 454.5 - 80, y: 300, width: 160, height: 200 }
  const nearBody = { nose: 400, shoulders: 520, hips: 400 + 0.38 * 1600, knees: null, ankles: null }
  const crowded = arrange(FRAME, VIEW, near, PORTRAIT, face, 'left', { visitor: nearBody, figure }, 250, 168)
  const k = crowded.figure.height / PORTRAIT.height
  const theirRight = crowded.figure.x + (face.x + face.width) * k
  const visitorLeft = FRAME.width - (near.x + near.width) * DRAWN
  assert.ok(theirRight < visitorLeft, `faces apart: ${theirRight.toFixed(0)} < ${visitorLeft.toFixed(0)}`)
  // A picture of them cut at the knees, beside a visitor whose floor is in the
  // photograph: its cut edge is at the frame's edge, not hanging in the room.
  const kneed = { nose: 290, shoulders: 420, hips: 900, knees: 1250, ankles: null }
  const SHORT = { width: 900, height: 1300 }
  const whole = { x: 250 - 43, y: 146, width: 86, height: 108 }
  const wholeBody = { nose: 200, shoulders: 290, hips: 200 + 0.38 * 900, knees: 200 + 0.625 * 900, ankles: 200 + 0.871 * 900 }
  const stood = arrange(FRAME, VIEW, whole, SHORT, face, 'left', { visitor: wholeBody, figure: kneed }, 188, 175)
  assert.ok(stood.figure.y + stood.figure.height >= FRAME.height - 1, 'no floating edge')
})

test('the room\'s light is read from what is colourless, not from a red shirt', () => {
  const px = (n: number, rgb: number[]) => Array.from({ length: n }, () => [...rgb, 255]).flat()
  // Mostly a red shirt, under a grey ceiling lit a little blue.
  const room = new Uint8ClampedArray([...px(3000, [180, 30, 40]), ...px(2000, [190, 195, 210])])
  const [r, g, b] = castOf(room)!
  assert.ok(b > r && Math.abs(r - 190) < 2 && Math.abs(g - 195) < 2, `${r} ${g} ${b}`)
  assert.equal(castOf(new Uint8ClampedArray(px(4000, [180, 30, 40]))), null)
})

test('the finish lifts black off zero, warms shadows, cools highlights, and darkens the ceiling', () => {
  // Two rows: black and white at the top, black and white at the bottom.
  const one = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255])
  finish(one, 2)
  const [black, white, low, high] = [0, 4, 8, 12].map((i) => [...one.slice(i, i + 3)])
  assert.ok(low[0] >= 6 && low[0] > low[2], `a lifted, warm black: ${low}`)
  assert.ok(high[2] > high[0], `a cool white: ${high}`)
  assert.ok(black[1] < low[1] && white[1] < high[1], 'the top darker')
})

test('a cut-out reaches as far as its furthest opaque pixel, between the rows given', () => {
  // 10 wide, 4 tall: opaque to column 6 in rows 1-2, to column 9 in row 3.
  const rgba = new Uint8ClampedArray(10 * 4 * 4)
  const fill = (y: number, from: number, to: number) => { for (let x = from; x <= to; x++) rgba[(y * 10 + x) * 4 + 3] = 255 }
  fill(1, 2, 6); fill(2, 3, 5); fill(3, 1, 9)
  assert.equal(reachOf(rgba, 10, 1, 3, 'right'), 6)
  assert.equal(reachOf(rgba, 10, 1, 3, 'left'), 2)
  assert.equal(reachOf(rgba, 10, 1, 4, 'right'), 9)
  assert.equal(reachOf(rgba, 10, 0, 1, 'right'), null)
})

test("their body covers the visitor's shoulder by a little at most", () => {
  // A broad picture: their face 150 wide, and their body reaching 500 pixels
  // past its middle toward the visitor - an arm at their side, a hand in a
  // pocket - beside a visitor standing well over on the other side.
  const face = { x: 375, y: 140, width: 150, height: 150 }
  const figure = { nose: 290, shoulders: 420, hips: 900, knees: 1250, ankles: 1600 }
  const body = { nose: 400, shoulders: 470, hips: 400 + 0.46 * 960, knees: 400 + 0.68 * 960, ankles: null }
  for (const side of ['left', 'right'] as const) {
    const toward = side === 'left' ? 1 : -1
    const reach = 450 + toward * 500
    // Unmirrored in the camera's picture: their left is the photograph's right.
    const seen = { x: side === 'left' ? 60 : VIEW.width - 60 - 96, y: 340, width: 96, height: 120 }
    const placed = arrange(FRAME, VIEW, seen, PORTRAIT, face, side, { visitor: body, figure }, 188, 175, reach)
    const k = placed.figure.height / PORTRAIT.height
    const headWide = seen.width * DRAWN
    const headX = FRAME.width - (seen.x + seen.width / 2) * DRAWN
    const shoulder = headX - toward * 1.2 * headWide
    const edge = placed.figure.x + reach * k
    assert.ok(toward * (edge - shoulder) <= OVERLAP * headWide + 1, `${side}: over by ${((toward * (edge - shoulder)) / headWide).toFixed(2)} faces`)
    // Without it, the same picture covered far more of them.
    const before = arrange(FRAME, VIEW, seen, PORTRAIT, face, side, { visitor: body, figure }, 188, 175)
    assert.ok(toward * (before.figure.x + reach * k - shoulder) > OVERLAP * headWide, `${side}: the check has something to catch`)
  }
})

test('their feet are cut off by zooming in, never past the camera\'s own detail', () => {
  const frame = { width: 1215, height: 2160 }
  // Drawn 2000 tall from a 1700 picture: knees at 1400, ankles at 1800.
  const figure = { x: -200, y: 0, width: 1100, height: 2000 }
  const marks = { knees: 1400 * 0.85, ankles: 1800 * 0.85 }
  const cut = feetCut(frame, figure, marks, 1700, 600, 1.78)!
  assert.equal(cut.y, 0)
  assert.ok(Math.abs(cut.height - 1600) < 1, `to mid-shin: ${cut.height}`)
  assert.ok(Math.abs(cut.width / cut.height - frame.width / frame.height) < 1e-9)
  assert.ok(cut.x >= 0 && cut.x + cut.width <= frame.width)
  // Feet already off the bottom, or no feet in their picture: nothing cut.
  assert.equal(feetCut(frame, { ...figure, y: 400 }, marks, 1700, 600, 1.78), null)
  assert.equal(feetCut(frame, figure, { knees: 1190, ankles: null }, 1700, 600, 1.78), null)
  // Far away, their feet high in the picture: zoomed no more than the camera allows.
  const small = feetCut(frame, { ...figure, height: 1000 }, marks, 1700, 600, 1.78)!
  assert.ok(Math.abs(small.height - 2160 / 1.78) < 1)
  assert.equal(feetCut(frame, figure, marks, 1700, 600, 1), null)
})

test("their shoulder stands against the visitor's, not over it", () => {
  const face = { x: 375, y: 140, width: 150, height: 150 }
  // Their shoulders found at 250 and 650 across their picture; the visitor's
  // at 150 and 346 across the camera's (unmirrored), their face 96 wide.
  const figure = { nose: 290, shoulders: 420, hips: 900, knees: 1250, ankles: 1600, across: [250, 650] as [number, number] }
  const body = { nose: 400, shoulders: 470, hips: 400 + 0.46 * 960, knees: 400 + 0.68 * 960, ankles: null, across: [150, 346] as [number, number] }
  const seen = { x: 200, y: 340, width: 96, height: 120 }
  const placed = arrange(FRAME, VIEW, seen, PORTRAIT, face, 'left', { visitor: body, figure }, 188, 175)
  const k = placed.figure.height / PORTRAIT.height
  // Outsides of the two shoulders: the joint and 0.3 of each one's face-width.
  const theirs = placed.figure.x + 650 * k + 0.3 * face.width * k
  const yours = FRAME.width - 346 * DRAWN - 0.3 * seen.width * DRAWN
  assert.equal(placed.apart, false)
  assert.ok(Math.abs(theirs - yours) < 1, `touching: ${theirs.toFixed(0)} against ${yours.toFixed(0)}`)
})

test('their head never leaves the frame: smaller rather than cut off', () => {
  // A tall star (250 cm asked for) beside a visitor standing far back and
  // well over toward the character's side: by height alone his hair ran
  // off the top and his head off the side.
  const face = { x: 375, y: 140, width: 150, height: 150 }
  const figure = { nose: 290, shoulders: 420, hips: 900, knees: 1250, ankles: 1600, across: [250, 650] as [number, number] }
  const seen = { x: 380, y: 200, width: 60, height: 75 }
  const body = { nose: 240, shoulders: 290, hips: 240 + 0.46 * 700, knees: 240 + 0.68 * 700, ankles: null, across: [370, 450] as [number, number] }
  const crown = 300
  for (const side of ['left', 'right'] as const) {
    const it = side === 'left' ? { seen, body, crown, figure } : {
      seen: { ...seen, x: VIEW.width - seen.x - seen.width },
      body: { ...body, across: [VIEW.width - 450, VIEW.width - 370] as [number, number] },
      crown: PORTRAIT.width - crown,
      figure: { ...figure, across: [PORTRAIT.width - 650, PORTRAIT.width - 250] as [number, number] },
    }
    const face2 = side === 'left' ? face : { ...face, x: PORTRAIT.width - face.x - face.width }
    const placed = arrange(FRAME, VIEW, it.seen, PORTRAIT, face2, side, { visitor: it.body, figure: it.figure }, 250, 160, null, it.crown)
    const k = placed.figure.height / PORTRAIT.height
    assert.ok(placed.figure.y >= 0.02 * FRAME.height - 1, `${side}: hair below the top, ${placed.figure.y.toFixed(0)}`)
    const hair = placed.figure.x + it.crown * k
    assert.ok(hair >= 0 && hair <= FRAME.width, `${side}: head inside, ${hair.toFixed(0)}`)
    const unbound = arrange(FRAME, VIEW, it.seen, PORTRAIT, face2, side, { visitor: it.body, figure: it.figure }, 250, 160)
    assert.ok(placed.figure.height <= unbound.figure.height, `${side}: smaller, not cut off`)
  }
})

test('a head is measured out from the face through the hair, not to a hand raised beside it', () => {
  // 40 wide, 3 rows: a hand at columns 0-6 and a head at 15-30, a gap between.
  const rgba = new Uint8ClampedArray(40 * 3 * 4)
  const fill = (y: number, from: number, to: number) => { for (let x = from; x <= to; x++) rgba[(y * 40 + x) * 4 + 3] = 255 }
  for (let y = 0; y < 3; y++) { fill(y, 0, 6); fill(y, 15, 30) }
  // A strand of hair two pixels out, past a gap the walk steps over.
  fill(1, 13, 13)
  assert.equal(headEdge(rgba, 40, 0, 3, 22, 'left'), 13)
  assert.equal(headEdge(rgba, 40, 0, 3, 22, 'right'), 30)
  // The plain furthest pixel would have been the hand.
  assert.equal(reachOf(rgba, 40, 0, 3, 'left'), 0)
  assert.equal(headEdge(rgba, 40, 0, 3, 10, 'left'), null)
})
