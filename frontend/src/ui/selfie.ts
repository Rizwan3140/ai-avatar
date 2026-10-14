/**
 * The arithmetic of a selfie with the avatar, kept apart from the canvas so it
 * can be checked without a browser.
 *
 * The picture is two layers: the camera frame, and the avatar lifted off the
 * white studio background of their own footage and stood in front of it.
 */

/**
 * What counts as studio backdrop: light, and without colour.
 *
 * Not "white". The brief says white and the footage is not: one avatar stands
 * against a grey that runs from 180 at the top to 210 at the floor, the other
 * in a white box whose walls carry her shadow down to the 150s. Measured on
 * both, the backdrop never has more than 8 between its strongest and weakest
 * channel, and skin never less than 25 — so colour is what separates them, and
 * brightness only has to rule out a charcoal shirt and black hair.
 */
const COLOURLESS = 16
const LIGHT = 110
/** An enclosed gap is at most this much of the frame. Measured: the space
 *  between an arm and a torso is a quarter of a percent; a shirt front under
 *  an open jacket is about three. */
const POCKET = 0.015
/** And at least this much. The white of an eye, a tooth and a watch face are
 *  also pale, colourless and enclosed — and a few dozen pixels across. */
const SPECK = 0.0003
/** And within this, per channel, of the backdrop beside it. */
const ALIKE = 24

/**
 * Make the backdrop around the avatar transparent, in place.
 *
 * Only backdrop that is *connected to the edge of the frame*. Keying every
 * pale pixel would put holes through a white shirt; a shirt is enclosed by the
 * jacket, the skin and the hair around it, so a fill that starts at the border
 * never reaches it. Not from the bottom edge: the feet are there, and pale
 * trousers running off the frame would be eaten upwards from the floor.
 *
 * ponytail: pale, colourless clothing that touches the backdrop — white
 * trainers on a studio floor, a white kurta against a white wall — is taken
 * for it. Footage delivered with an alpha matte, or a segmentation model, the
 * day that garment is on an avatar above the knee, where the selfie shows it.
 */
export function cutOut(rgba: Uint8ClampedArray, width: number, height: number): void {
  const white = (i: number) => {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    const weakest = Math.min(r, g, b)
    return weakest >= LIGHT && Math.max(r, g, b) - weakest <= COLOURLESS
  }

  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  const visit = (i: number) => {
    if (seen[i] || !white(i)) return
    seen[i] = 1
    stack.push(i)
  }

  for (let x = 0; x < width; x++) visit(x)
  for (let y = 0; y < height; y++) {
    visit(y * width)
    visit(y * width + width - 1)
  }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % width
    if (x > 0) visit(i - 1)
    if (x < width - 1) visit(i + 1)
    if (i >= width) visit(i - width)
    if (i < width * (height - 1)) visit(i + width)
  }

  // The backdrop seen through the crook of an arm, or between the legs: cut
  // off from the edge, so the fill above never reached it, and left behind as
  // a sliver of studio in somebody's living room. A pocket goes if it is
  // small and no brighter than the backdrop on the rows it sits in — which is
  // what keeps a white shirt under a jacket: on a grey backdrop it is too
  // bright to be backdrop, and on a white one it is too big to be a gap.
  const brightness = (i: number) => rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]
  const rows = new Float32Array(height)
  let everywhere = 0
  let counted = 0
  for (let y = 0; y < height; y++) {
    let sum = 0
    let n = 0
    for (let i = y * width; i < (y + 1) * width; i++) {
      if (seen[i] !== 1) continue
      sum += brightness(i)
      n++
    }
    rows[y] = n ? sum / n : -1
    everywhere += sum
    counted += n
  }
  const typical = counted ? everywhere / counted : 0
  const largest = width * height * POCKET
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !white(start)) continue
    const pocket = [start]
    seen[start] = 2
    let off = 0
    for (let at = 0; at < pocket.length; at++) {
      const i = pocket[at]
      const x = i % width
      const y = (i - x) / width
      off += brightness(i) - (rows[y] < 0 ? typical : rows[y])
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (j < 0 || j >= seen.length || seen[j] || !white(j)) continue
        seen[j] = 2
        pocket.push(j)
      }
    }
    const sized = pocket.length <= largest && pocket.length >= width * height * SPECK
    // Not brighter than the backdrop, by much. Darker is fine and common: the
    // wall behind the crook of an arm is in that arm's shadow.
    if (sized && off / pocket.length <= 3 * ALIKE) {
      for (const i of pocket) seen[i] = 1
    }
  }

  const gone = (i: number) => seen[i] === 1
  for (let i = 0; i < seen.length; i++) {
    if (gone(i)) {
      rgba[i * 4 + 3] = 0
      continue
    }
    // One pixel of feather where the figure meets what was removed, so the
    // outline is not a staircase against a photograph.
    const x = i % width
    const edge =
      (x > 0 && gone(i - 1)) ||
      (x < width - 1 && gone(i + 1)) ||
      (i >= width && gone(i - width)) ||
      (i < width * (height - 1) && gone(i + width))
    if (edge) rgba[i * 4 + 3] = 150
  }
}

/**
 * Whether a picture arrived with its background already removed.
 *
 * A picture made for the selfie is a cut-out PNG; a frame of footage, or a
 * picture saved on its studio backdrop, is opaque edge to edge. More than a
 * fiftieth of it clear is a cut-out — less is the soft corner of a scan.
 */
export function isCutOut(rgba: Uint8ClampedArray): boolean {
  let clear = 0
  let looked = 0
  for (let i = 3; i < rgba.length; i += 64) {
    looked++
    if (rgba[i] < 128) clear++
  }
  return looked > 0 && clear / looked > 0.02
}

export type Box = { x: number; y: number; width: number; height: number }

/** The smallest box holding everything that was not removed, or null. */
export function bounds(rgba: Uint8ClampedArray, width: number, height: number): Box | null {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!rgba[(y * width + x) * 4 + 3]) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

type Size = { width: number; height: number }

/**
 * Where the avatar goes on the camera's picture.
 *
 * At one fixed size the avatar is right for exactly one visitor. Somebody who
 * steps close fills the frame beside a doll; somebody who hangs back is a
 * figure across the room behind a giant. So the avatar's face is drawn the
 * size of the visitor's own, level with it, on the side the visitor is not.
 *
 * The same size, not a little larger. It was 1.15, on the reasoning that
 * whoever holds the phone is nearer the lens — and it was also capped so the
 * avatar's whole picture stayed inside the frame. A real picture of them is a
 * wide close-up with an arm out, so the cap bit first: beside a visitor
 * standing at a kiosk, whom a landscape webcam cropped to a portrait always
 * shows large, they came out two thirds the size and read as a sticker. They
 * run off the edge of the frame now, as the person holding the phone does in
 * any selfie, and the only thing that holds their size back is the two faces
 * needing room side by side.
 *
 * **The camera's picture is never moved.** It was: slid sideways so the
 * visitor stood two thirds across, and enlarged toward anybody standing far
 * back. That made the photograph a different picture from the one in the
 * preview the visitor had just posed with — and, measuring faces across the
 * camera's whole frame, it once slid over to a man at the very edge of it,
 * outside the preview altogether, and photographed him. What the visitor is
 * shown is what is taken: `view` is the camera's picture already cut to the
 * frame's shape, the same cut the preview shows, and only the avatar is placed.
 *
 * `visitor` and `figureFace` are faces as the detector found them, in the
 * pixels of `view` (not mirrored) and of the avatar's picture. Either may be
 * null: then an ordinary distance is assumed.
 *
 * **Their side is theirs, and it is never changed.** `side` is which edge of
 * the photograph this character stands at, set once for each of them. Their
 * picture is made for that side — an arm out, cut at the edge it leaves by —
 * so it is not moved across for a visitor standing there, and it is never
 * drawn turned round: for one release it was, and the same person facing the
 * other way from one photograph to the next is not the same person. A visitor
 * standing in their place sees it in the preview, and steps aside.
 *
 * `figure` is where the avatar's picture is drawn.
 */
export type Side = 'left' | 'right'

/**
 * How much nearer the camera the character stands than the visitor: the one
 * holding the phone. Matched size for size they read as two cut-outs laid
 * side by side; in a real selfie the person with the phone is nearer, larger,
 * and in front. Asked for after seeing exactly that in two reference selfies,
 * then raised from 1.2: "the avatar is the hero of the image, so make it a bit
 * larger than the user".
 */
export const NEARER = 1.3

/**
 * A little taller than the real difference, when the real heights are known:
 * the character is the hero of the picture, and a star of average height
 * beside an average visitor should still stand out. Asked for as "the actual
 * height difference and a little bit more".
 */
export const HERO = 1.05

/** How far the character's body may cover the visitor's shoulder, in the
 *  visitor's face-widths: a little, as one person half in front of another. */
export const OVERLAP = 0.25

/** How far the outside of a shoulder is past the shoulder joint the pose
 *  detector marks, in that person's face-widths: the deltoid and a sleeve. */
const SHOULDER_PAD = 0.3

/** No limit, in whichever direction is toward the visitor. */
const centreFar = (onLeft: boolean) => (onLeft ? Infinity : -Infinity)

/**
 * How far a cut-out reaches toward the visitor, in its picture's pixels: the
 * furthest opaque pixel on that side (`toward`), between the rows given -
 * their shoulders to their hips, where an arm at their side or a hand in a
 * pocket stands out. Null when nothing there is opaque.
 */
export function reachOf(rgba: Uint8ClampedArray, width: number, top: number, bottom: number, toward: Side): number | null {
  const height = rgba.length / 4 / width
  let edge: number | null = null
  for (let y = Math.max(0, Math.floor(top)); y < Math.min(height, Math.ceil(bottom)); y++) {
    const row = y * width * 4
    if (toward === 'right') {
      for (let x = width - 1; x > (edge ?? -1); x--) if (rgba[row + x * 4 + 3] >= 128) { edge = x; break }
    } else {
      for (let x = 0; x < (edge ?? width); x++) if (rgba[row + x * 4 + 3] >= 128) { edge = x; break }
    }
  }
  return edge
}

/**
 * Where to cut the finished photograph so the character's feet are not in it:
 * "zoom in to cut his feet off". A box of the frame's own shape, from its top
 * down to the middle of their shins - the top kept, because any window lower
 * down shows more of their feet, not less - centred on `between` (the middle
 * of the two of them). Null when their feet are already out of the frame or
 * their picture has none. Never zoomed past `most`, the camera's own detail
 * over the photograph's, so nothing is enlarged: past that, a little of their
 * shoes beats a soft photograph.
 */
export function feetCut(
  frame: Size,
  figure: Box,
  marks: { knees: number | null; ankles: number | null },
  pictureHeight: number,
  between: number,
  most: number,
): Box | null {
  const { width: W, height: H } = frame
  if (marks.ankles === null || most <= 1) return null
  const k = figure.height / pictureHeight
  const ankles = figure.y + marks.ankles * k
  if (ankles >= H) return null
  const knees = marks.knees === null ? null : figure.y + marks.knees * k
  const bottom = knees === null ? ankles - 0.06 * H : knees + 0.5 * (ankles - knees)
  const tall = Math.min(H, Math.max(bottom, H / most))
  const wide = (tall * W) / H
  const x = Math.max(0, Math.min(W - wide, between - wide / 2))
  return { x, y: 0, width: wide, height: tall }
}

/**
 * How tall a face is, in centimetres, as MediaPipe's detector boxes it when
 * shown it at one size (`faces.findFace` settles every face so) - the ruler
 * a visitor's height is measured with. One webcam has no other: a person's
 * height in the picture says nothing until something in it has a known
 * size, and adult faces vary least. Fitted, with the hips and knees below, to
 * sixteen photographs from this cabinet of one man of 175 cm, about a metre
 * from the camera: he reads 175 cm on average, 8.6 either way and never 20
 * off - to his shoes or cut at the knees alike. v2.3.0 (21, the box as found, a textbook's hips and knees) read
 * him 169-221 and 194 on average: the detector draws a small face's box
 * relatively larger, so it depended on which look found him.
 * ponytail: one man's photographs; calibrate against more people of known
 * height (the selfie's hover text shows the estimate).
 */
export const FACE_CM = 16.9

/** How far above the floor each mark is, as a share of a standing person's
 *  height. Nose and ankles are the usual proportions of an adult body; hips
 *  and knees were fitted with `FACE_CM`, on the photographs cut above the
 *  shoes - the only ones they are used for. Lower than a textbook's 0.53 and
 *  0.285: a visitor close enough to be cut at the knees is looked down on by
 *  a camera a metre up, and their knees fall lower in the picture. */
const ABOVE = { nose: 0.91, shoulders: 0.818, hips: 0.45, knees: 0.23, ankles: 0.039 } as const

/**
 * A body's height in its picture's pixels, and where its floor is - from the
 * nose to the lowest of ankles, knees or hips it shows, by the proportions
 * above. Seen only to the knees, the floor is somewhere below the picture,
 * and that is where it is put. Null with no nose, or nothing below the waist.
 */
export function statureOf(body: Body): { tall: number; floor: number } | null {
  if (body.nose === null) return null
  for (const mark of ['ankles', 'knees', 'hips'] as const) {
    const at = body[mark]
    if (at === null) continue
    const tall = (at - body.nose) / (ABOVE.nose - ABOVE[mark])
    if (tall > 0) return { tall, floor: body.nose + ABOVE.nose * tall }
  }
  return null
}

/** Roughly how tall a visitor is, in centimetres, from their body and their
 *  face's height (as `faces.findFace` measures it) in the same picture - see `FACE_CM`.
 *  Null when their body says too little. */
export function heightOf(body: Body, faceTall: number | null): number | null {
  const stature = statureOf(body)
  return stature && faceTall && faceTall > 0 ? (stature.tall / faceTall) * FACE_CM : null
}

export function arrange(
  frame: Size,
  view: Size,
  visitor: Box | null,
  figure: Size,
  figureFace: Box | null,
  side: Side = 'left',
  bodies: { visitor: Body; figure: Body } | null = null,
  tall: number | null = null,
  visitorCm: number | null = null,
  reach: number | null = null,
  crown: number | null = null,
): { figure: Box; apart: boolean } {
  const { width: W, height: H } = frame
  const scale = W / view.width

  const headTall = visitor ? visitor.height * scale : 0.17 * H
  const headWide = visitor ? visitor.width * scale : headTall * 0.8
  // Mirrored, as the preview is, so their face is measured from the far edge.
  const headX = visitor ? W - (visitor.x + visitor.width / 2) * scale : 0.5 * W
  const headY = visitor ? (visitor.y + visitor.height / 2) * scale : 0.4 * H

  const onLeft = side === 'left'
  // A picture taken from the phone is head and shoulders: without a face found
  // in it, assume one where such a picture has it.
  const face = figureFace ?? {
    x: figure.width * 0.36,
    y: figure.height * 0.1,
    width: figure.width * 0.28,
    height: figure.height * 0.24,
  }
  // The room their side has: from the picture's edge to the near edge of the
  // visitor's face, less a gap.
  const room = (onLeft ? headX - headWide / 2 : W - headX - headWide / 2) - 0.07 * W
  // Their face the size of the visitor's. Held back only by two things: never
  // a doll, whatever the faces say; and never over the visitor's face — unless
  // the visitor is standing where they stand, when there is no beside to keep
  // to and shrinking them into what is left would make them a doll after all.
  const fits = room < 0.18 * W ? Infinity : room / face.width
  let k = Math.min(Math.max(headTall / face.height, (0.45 * H) / figure.height), fits)
  const byFace = k
  // Then fitted to the visitor's body, when both bodies are found: the
  // nose level, and the lowest mark both show at the same height - see
  // `fitBodies`. "If the user's picture captures only till knee level, the
  // avatar's also has to be till knee level." The face alone could not do
  // that: a picture taken from a little above has a large head and short
  // legs, and matched by the face it ran off the bottom while the visitor
  // stood on the floor in plain view. Kept within 40% of the face's own
  // size either way, so a misread body does not make a giant or a doll.
  const fit = bodies ? fitBodies(bodies.visitor, bodies.figure) : null
  if (fit) k = clamp(fit.k * scale, 0.6 * k, 1.6 * k)
  // Level: noses beside each other when the bodies were fitted, else eyes.
  let y = fit ? fit.at * scale - fit.from * k : headY - (face.y + face.height / 2) * k
  // By their real heights, when the studio gave the character's (`tall`, in
  // centimetres) and the visitor's was estimated (`visitorCm`, from
  // `heightOf`): the two on one floor, the character as much taller or
  // shorter than the visitor as they really are, and `HERO` more. Kept
  // within 40% of the face's own size.
  const theirs = fit && tall && visitorCm ? statureOf(bodies!.figure) : null
  const visitors = theirs ? statureOf(bodies!.visitor) : null
  const byHeight = theirs && visitors ? { theirs, visitors, visitorCm: visitorCm! } : null
  if (byHeight) {
    // Within a fifth either way: an estimate off by its usual 10 cm should
    // not make a giant, and a star is not a third taller than anyone.
    const ratio = clamp(tall! / byHeight.visitorCm, 0.85, 1.2) * HERO
    k = clamp((byHeight.visitors.tall * scale * ratio) / byHeight.theirs.tall, 0.6 * byFace, 1.6 * byFace)
    // Never over the visitor's face, as on the other path: shorter than their
    // real difference beats one face drawn across another.
    k = Math.min(k, fits)
    y = byHeight.visitors.floor * scale - byHeight.theirs.floor * k
  } else {
    // Otherwise a step nearer the camera (`NEARER`), as the one holding the
    // phone. Grown about the visitor's chest, which is about the camera's
    // height: a nearer person's head rises in the picture and their legs run
    // lower.
    const chest =
      fit && bodies!.visitor.shoulders !== null ? bodies!.visitor.shoulders * scale : headY + 1.6 * headTall
    // Not past the room beside the visitor's face, though: two faces never one
    // over the other, the nearer one included.
    const nearer = Math.max(1, Math.min(NEARER, fits / k))
    y = chest - (chest - y) * nearer
    k *= nearer
  }
  const toward = onLeft ? 1 : -1
  // The outside of the visitor's shoulder on the character's side: from the
  // shoulder the pose detector found (mirrored, as the photograph is), else
  // guessed from their face. "Till now you were checking head and head - now
  // add shoulder to shoulder too."
  const visitorAcross = bodies?.visitor.across
  const visitorShoulder = visitorAcross
    ? W - (onLeft ? visitorAcross[1] : visitorAcross[0]) * scale - toward * SHOULDER_PAD * headWide
    : headX - toward * 1.2 * headWide
  const ours = bodies?.figure.across
  // Never out of the frame: their whole head inside it, top and side - "i
  // don't want the avatar to go out of the screen, never". Where it would not
  // fit - their hair over the top, or too little room between the frame's
  // edge and the visitor's shoulder for their head and near shoulder - they
  // are drawn smaller, about their feet when those were stood on the
  // visitor's floor, else about their face: smaller beats cut off. Not below
  // 0.6 of the face's size, which is a doll.
  const edge = 0.02 * W
  const floorAt = fit ? statureOf(bodies!.figure)?.floor : undefined
  const pivot = floorAt ?? face.y + face.height / 2
  const shrink = (to: number) => {
    to = Math.max(to, 0.6 * byFace)
    if (to >= k) return
    const kept = y + pivot * k
    k = to
    y = kept - pivot * k
  }
  if (y < 0.02 * H) shrink((y + pivot * k - 0.02 * H) / pivot)
  if (crown !== null && ours) {
    const span = onLeft ? ours[1] + SHOULDER_PAD * face.width - crown : crown - ours[0] + SHOULDER_PAD * face.width
    const across = onLeft ? visitorShoulder - edge : W - edge - visitorShoulder
    if (span > 0 && across > 0) shrink(across / span)
  }
  const drawn = { width: figure.width * k, height: figure.height * k }
  const faceWide = face.width * k
  // Shoulder to shoulder with the visitor, theirs a little in front: "no gap
  // between the user and the avatar". Kept apart, the two read as a pair of
  // cut-outs; this is two people standing together. Held back by three
  // things only: never over the visitor's face; never so far across that the
  // cut end of their outstretched arm shows inside the frame (their picture
  // is cut where the arm leaves it); and their head inside the frame. A
  // visitor standing in their place has no beside to stand at, so then they
  // keep to a quarter of the way in, as they always did.
  const faceAt = (face.x + face.width / 2) * k
  let centre: number
  if (fits === Infinity) {
    const fromEdge = clamp(0.27 * W, 0.03 * W + faceWide / 2, Math.max(0.03 * W + faceWide / 2, room + 0.03 * W - faceWide / 2))
    centre = onLeft ? fromEdge : W - fromEdge
  } else {
    // Their shoulder against the visitor's, and not over it: "against my
    // shoulder, not overlap my shoulder". From where the detector found their
    // near shoulder in their picture, else a face and a bit from their face.
    const touching = ours
      ? visitorShoulder - toward * SHOULDER_PAD * faceWide + faceAt - (onLeft ? ours[1] : ours[0]) * k
      : visitorShoulder - toward * 1.1 * faceWide
    const clearOfFace = headX - toward * (headWide / 2 + faceWide / 2 + 0.02 * W)
    const armOut = onLeft ? faceAt : W - (drawn.width - faceAt)
    // And their body - the shoulder, the arm at their side - over the
    // visitor's by a little at most (`OVERLAP`): "it's overlapping me, it can
    // only do it just a bit". The face alone said nothing of how far a
    // broad-shouldered picture reaches across.
    const bodyClear = reach === null ? centreFar(onLeft) : visitorShoulder + toward * OVERLAP * headWide + faceAt - reach * k
    centre = onLeft
      ? Math.min(touching, clearOfFace, armOut, bodyClear)
      : Math.max(touching, clearOfFace, armOut, bodyClear)
  }
  // Their head inside the frame on their own side: the far edge of their hair
  // (`crown`), else their face.
  const headIn = crown === null ? faceWide / 2 + edge : edge + toward * (faceAt - crown * k)
  centre = onLeft ? Math.max(centre, headIn) : Math.min(centre, W - headIn)
  // Still a gap, because the visitor stands further over than the picture
  // can follow: the preview asks them to step closer. Measured from the edge
  // of their body where it is known, else from their face.
  const near = reach === null ? centre + toward * 1.3 * faceWide : centre - faceAt + reach * k
  const apart = fits !== Infinity && toward * (visitorShoulder - near) > 0.5 * faceWide
  // And out to the edge on their own side, at least. Their picture is cut
  // where their arm leaves it; a little way inside the frame, that cut is a
  // ruled line down the photograph.
  const placed = centre - (face.x + face.width / 2) * k
  const x = onLeft ? Math.min(placed, 0) : Math.max(placed, W - drawn.width)
  // They do not float. A picture of them that ends at the chest has that edge
  // at the frame's edge, or they are a bust hanging in the room. Not one that
  // reaches their shoes and was fitted: their feet are where the visitor's are.
  // Stood by height, a picture ending at the knees has its floor somewhere
  // below its edge - and that edge still floats if the visitor's floor shows.
  const shod = fit !== null && bodies!.figure.ankles !== null
  if (!shod && y + drawn.height < H) y = H - drawn.height

  return { figure: { x, y, ...drawn }, apart }
}

/**
 * A body's marks, top to bottom: how far down a picture its nose, shoulders,
 * hips, knees and ankles are, in its pixels. Null for any the picture does not
 * hold - not seen, or past its bottom edge.
 */
export type Body = {
  nose: number | null
  shoulders: number | null
  hips: number | null
  knees: number | null
  ankles: number | null
  /** Where the two shoulders are across the picture, left then right, in
   *  its pixels - when both are seen. What `arrange` stands the character
   *  shoulder to shoulder by. */
  across?: [number, number] | null
}

/** A body from MediaPipe's 33 pose points (0 to 1 down the picture). A mark
 *  counts when the model is sure of it and it is inside the picture: one at
 *  the very bottom edge is the frame cutting the person off. Of a pair,
 *  whichever is seen; both, their middle. */
/** The pixels of one box of a picture, for measuring that part of it alone. */
export function regionOf(rgba: Uint8ClampedArray, width: number, box: Box): Uint8ClampedArray {
  const height = rgba.length / 4 / width
  const x0 = Math.max(0, Math.floor(box.x))
  const x1 = Math.min(width, Math.ceil(box.x + box.width))
  const y0 = Math.max(0, Math.floor(box.y))
  const y1 = Math.min(height, Math.ceil(box.y + box.height))
  if (x1 <= x0 || y1 <= y0) return new Uint8ClampedArray(0)
  const out = new Uint8ClampedArray((x1 - x0) * (y1 - y0) * 4)
  for (let y = y0; y < y1; y++) out.set(rgba.subarray((y * width + x0) * 4, (y * width + x1) * 4), (y - y0) * (x1 - x0) * 4)
  return out
}

/**
 * How much to darken the character to the visitor's light: the visitor's
 * brightest (their whites, as lit in this room) over the character's, never
 * brighter, and never below 0.7. A character photographed in a studio has
 * whites at 250; a visitor's white shirt under office light is 200, and the
 * difference is what made the character glow as if lit from inside.
 */
export function lightGain(visitorHigh: number, figureHigh: number): number {
  return clamp(visitorHigh / Math.max(1, figureHigh), 0.7, 1)
}

export function bodyOf(points: { x: number; y: number; visibility?: number }[], height: number, width = 0): Body {
  const at = (...ids: number[]) => {
    const seen = ids
      .map((id) => points[id])
      .filter((p) => p && (p.visibility ?? 1) >= 0.5 && p.y >= 0 && p.y <= 0.98 && p.x >= 0 && p.x <= 1)
    return seen.length ? (seen.reduce((sum, p) => sum + p.y, 0) / seen.length) * height : null
  }
  const sure = (p: { x: number; visibility?: number } | undefined) => !!p && (p.visibility ?? 1) >= 0.5 && p.x >= 0 && p.x <= 1
  const across: [number, number] | null =
    width && sure(points[11]) && sure(points[12])
      ? ([Math.min(points[11].x, points[12].x) * width, Math.max(points[11].x, points[12].x) * width] as [number, number])
      : null
  return { nose: at(0), shoulders: at(11, 12), hips: at(23, 24), knees: at(25, 26), ankles: at(27, 28), across }
}

/**
 * How to stand the character's body against the visitor's: the scale between
 * them (visitor pixels to character pixels) and the marks to put level.
 *
 * From the nose to the lowest mark both bodies show - ankles, else knees,
 * else hips, else shoulders. So a visitor in the photograph to the knees has
 * the character's knees put at the visitor's knees, and the bottom of the
 * photograph cuts both of them at the same place; a visitor seen to the shoes
 * has the character's shoes on the same floor. Null when there is no such
 * pair: the face then decides alone.
 */
export function fitBodies(visitor: Body, figure: Body): { k: number; at: number; from: number } | null {
  if (visitor.nose === null || figure.nose === null) return null
  for (const mark of ['ankles', 'knees', 'hips', 'shoulders'] as const) {
    const theirs = visitor[mark]
    const ours = figure[mark]
    if (theirs === null || ours === null) continue
    const span = ours - figure.nose
    const k = (theirs - visitor.nose) / span
    if (span > 0 && k > 0) return { k, at: visitor.nose, from: figure.nose }
  }
  return null
}

/**
 * The shape and size of the photograph, for the camera it is taken with.
 *
 * It was one shape whatever the camera: tall, two by three, the shape of a
 * phone held upright. A webcam's picture is wide. Cut to that shape, a little
 * over a third of its width survived, and that strip was then enlarged to
 * twice its size to fill the frame — a photograph zoomed in on the visitor's
 * face and soft all over, from a camera that was neither.
 *
 * So the photograph follows the camera. A wide camera gives a wide photograph,
 * four by three: all of its height and three quarters of its width, and from a
 * 1080p camera not one pixel enlarged.
 *
 * **A camera stood on its side gives nine by sixteen** - a phone's shape and
 * the panel's, which is the photograph that was wanted - and gives all of
 * itself to it: nothing cut, nothing enlarged. That is the only way a wide
 * webcam makes a tall photograph without the zoom above, so it is done with
 * the camera's mount and `turned`, not here. Enlarged only when the camera is
 * too small to make 1080 on the short side, never past 2160 on the long one.
 */
export function frameFor(camera: Size): Size {
  const cut = centreCut(camera, camera.width >= camera.height ? { width: 4, height: 3 } : { width: 9, height: 16 })
  const short = Math.min(cut.width, cut.height)
  const long = Math.max(cut.width, cut.height)
  const scale = Math.min(Math.max(1, 1080 / short), 2160 / long)
  return { width: Math.round(cut.width * scale), height: Math.round(cut.height * scale) }
}

/** How far a camera mounted on its side has to be turned to stand its picture
 *  up: a quarter turn either way, half, or not at all. Anything else is none. */
export type Turn = 0 | 90 | 180 | 270
export const turnFrom = (said: string | null): Turn =>
  ([90, 180, 270] as const).find((turn) => String(turn) === said) ?? 0

/**
 * How this machine's webcam is mounted, for the selfie and try-on alike.
 *
 * A webcam stood on its side, so a wide camera takes a tall photograph with
 * nothing cut and nothing enlarged. The browser cannot know how a camera is
 * mounted, so it assumes how this cabinet's is — a quarter turn, 270, asked
 * for as the default once that mount had been tried — and is told otherwise
 * in the address: `?turn=0` for a camera the right way up, or 90 for one
 * turned the other way. That browser remembers what it was told, because the
 * camera belongs to the machine the browser is on. `from` is for the checks.
 */
export const MOUNTED: Turn = 270

export function cameraTurn(
  from: { search: string; storage?: Pick<Storage, 'getItem' | 'setItem'> } = {
    search: globalThis.location?.search ?? '',
    storage: globalThis.localStorage,
  },
): Turn {
  const KEY = 'luxora.selfie.turn'
  try {
    const said = new URLSearchParams(from.search).get('turn')
    if (said !== null) from.storage?.setItem(KEY, String(turnFrom(said)))
    const kept = from.storage?.getItem(KEY) ?? null
    return kept === null ? MOUNTED : turnFrom(kept)
  } catch {
    return MOUNTED // no storage here to say otherwise
  }
}

/** The size of a camera's picture once it has been stood up. */
export const turned = (camera: Size, turn: Turn): Size =>
  turn % 180 ? { width: camera.height, height: camera.width } : camera

/** The middle of a picture, cut to the shape of the frame: how much of it, and
 *  from where. The preview and the photograph both use this, so they are the
 *  same picture. */
export function centreCut(picture: Size, frame: Size): Box {
  const width = Math.min(picture.width, (picture.height * frame.width) / frame.height)
  const height = (width * frame.height) / frame.width
  return { x: (picture.width - width) / 2, y: (picture.height - height) / 2, width, height }
}

type Colour = [number, number, number]

/** The average colour of what is there. Every fourth pixel is plenty. */
export function meanColour(rgba: Uint8ClampedArray): Colour {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < rgba.length; i += 16) {
    if (rgba[i + 3] < 128) continue
    r += rgba[i]
    g += rgba[i + 1]
    b += rgba[i + 2]
    n++
  }
  return n ? [r / n, g / n, b / n] : [128, 128, 128]
}

/**
 * The colour of the light, not of what it falls on: the average of the
 * nearly colourless pixels - ceiling, walls, a white shirt - which show the
 * light's tint and nothing else. The plain average was the light's colour
 * only in a grey room: beside a visitor in a red shirt it was red, and a
 * character in white linen came out pink. Null with too few to go by.
 */
export function castOf(rgba: Uint8ClampedArray): Colour | null {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < rgba.length; i += 16) {
    if (rgba[i + 3] < 128) continue
    const hi = Math.max(rgba[i], rgba[i + 1], rgba[i + 2])
    const lo = Math.min(rgba[i], rgba[i + 1], rgba[i + 2])
    if (hi < 40 || hi > 250 || hi - lo > 0.2 * hi) continue
    r += rgba[i]
    g += rgba[i + 1]
    b += rgba[i + 2]
    n++
  }
  return n > 50 ? [r / n, g / n, b / n] : null
}

/**
 * The finishing grade of the whole photograph, from two selfies the owner
 * held up as the quality wanted: blacks lifted off zero (the old grade
 * crushed the darkest twentieth to 0), shadows a little warm and highlights a
 * little cool - as a phone renders skin against an office - and the top of
 * the picture, the ceiling of lamps, brought down.
 */
export function finish(rgba: Uint8ClampedArray, width: number): void {
  const height = rgba.length / 4 / width
  for (let i = 0; i < rgba.length; i += 4) {
    const l = clamp((0.3 * rgba[i] + 0.59 * rgba[i + 1] + 0.11 * rgba[i + 2]) / 255, 0, 1)
    const warm = (1 - l) * (1 - l)
    const cool = l * l
    const y = Math.floor(i / 4 / width) / height
    const down = 0.86 + 0.14 * clamp(y / 0.45, 0, 1)
    rgba[i] = (6 + (rgba[i] + 7 * warm - 10 * cool) * (249 / 255)) * down
    rgba[i + 1] = (6 + rgba[i + 1] * (249 / 255)) * down
    rgba[i + 2] = (6 + (rgba[i + 2] - 7 * warm + 10 * cool) * (249 / 255)) * down
  }
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const light = ([r, g, b]: Colour) => 0.299 * r + 0.587 * g + 0.114 * b || 1

/**
 * What to multiply the avatar's colours by so they sit in the room.
 *
 * The footage is lit flat and neutral for a white studio; the room behind the
 * visitor is tube-lit, or warm, or dim. Pasted in untouched the avatar reads
 * as a sticker. This leans their colour toward the room's cast and a little
 * toward its brightness — a little, and bounded, because a figure dragged all
 * the way to a dark green room is no longer the person on the panel.
 *
 * ponytail: a colour cast, not relighting. No shadows fall where the room's
 * light would put them. A hosted relighting model behind the "Realistic" look
 * is the upgrade; it sends the photograph off the cabinet, which is a consent
 * question before it is an engineering one.
 */
export function toneGains(room: Colour, figure: Colour): Colour {
  const roomLight = light(room)
  const figureLight = light(figure)
  const lift = clamp(Math.sqrt(roomLight / figureLight), 0.86, 1.1)
  return [0, 1, 2].map((c) =>
    clamp((room[c] / roomLight / ((figure[c] || 1) / figureLight)) ** 0.5, 0.88, 1.14) * lift,
  ) as Colour
}

/** How dark the darks are, how bright the brights, and how much colour. */
export type Tone = { low: number; high: number; colour: number }

/**
 * The tonal range of a picture: the brightness its darkest and brightest
 * fiftieths sit at, and how saturated it is on average. What is transparent
 * does not count.
 *
 * A studio picture runs from near black to near white and is rich. A webcam's
 * does not: its blacks are lifted, its whites dulled, its colour thin. Laid
 * side by side unmatched, that difference is the whole of "the avatar's
 * quality and the user's do not match" — before sharpness is even looked at.
 */
export function tone(rgba: Uint8ClampedArray): Tone {
  const seen = new Uint32Array(256)
  let colour = 0
  let n = 0
  for (let i = 0; i < rgba.length; i += 16) {
    if (rgba[i + 3] < 128) continue
    const r = rgba[i]
    const g = rgba[i + 1]
    const b = rgba[i + 2]
    seen[Math.round(0.299 * r + 0.587 * g + 0.114 * b)]++
    const most = Math.max(r, g, b)
    colour += most ? (most - Math.min(r, g, b)) / most : 0
    n++
  }
  if (!n) return { low: 0, high: 255, colour: 0 }
  const at = (share: number) => {
    let under = 0
    for (let level = 0; level < 256; level++) {
      under += seen[level]
      if (under >= share * n) return level
    }
    return 255
  }
  return { low: at(0.02), high: at(0.98), colour: colour / n }
}

/**
 * Give a picture another's tonal range, in place: its darks to where the
 * other's are, its brights likewise, its colour as thin or as rich.
 *
 * `strength` is how far to go, 0 to 1. Not all the way: a studio portrait
 * dragged the whole distance to a webcam's range is a bad photograph of them,
 * and it is the gap that has to close, not the avatar that has to be ruined.
 */
export function grade(rgba: Uint8ClampedArray, from: Tone, to: Tone, strength: number): void {
  const mix = (a: number, b: number) => a + (b - a) * strength
  const low = mix(from.low, to.low)
  const high = mix(from.high, to.high)
  const span = (high - low) / Math.max(1, from.high - from.low)
  const rich = from.colour > 0.01 ? clamp(mix(1, to.colour / from.colour), 0.6, 1.15) : 1
  for (let i = 0; i < rgba.length; i += 4) {
    if (!rgba[i + 3]) continue
    const r = rgba[i]
    const g = rgba[i + 1]
    const b = rgba[i + 2]
    const light = 0.299 * r + 0.587 * g + 0.114 * b
    const moved = low + (light - from.low) * span
    // Each channel keeps its distance from grey, scaled by how rich the other
    // picture is, around the new brightness.
    rgba[i] = moved + (r - light) * span * rich
    rgba[i + 1] = moved + (g - light) * span * rich
    rgba[i + 2] = moved + (b - light) * span * rich
  }
}

/**
 * How crisp a square picture is, as a number that does not care how bright or
 * how contrasty it is: how tall its typical edge is in one pixel's step,
 * against how much the picture varies at all.
 *
 * Not the *sum* of the steps between neighbouring pixels, which is what this
 * first added up. That sum is the same however an edge is spread: a rise of a
 * hundred in one pixel and a rise of a hundred over four are both a hundred.
 * It scored a blurred face as the crisper of two, and would have softened
 * nothing. Each step is weighted by its own size instead, so one tall step
 * counts for more than four short ones.
 *
 * Asked of two faces each shrunk to the same small square, it says which was
 * photographed more sharply — and a face is what the eye compares. Shrinking
 * also averages a webcam's noise away, which measured at full size reads as
 * detail and makes the soft picture look like the sharp one.
 */
export function crispness(rgba: Uint8ClampedArray, side: number): number {
  const light = new Float32Array(side * side)
  let sum = 0
  for (let i = 0; i < light.length; i++) {
    light[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
    sum += light[i]
  }
  const mean = sum / light.length
  let steps = 0
  let squares = 0
  let spread = 0
  let n = 0
  for (let y = 0; y < side - 1; y++) {
    for (let x = 0; x < side - 1; x++) {
      const i = y * side + x
      const across = Math.abs(light[i] - light[i + 1])
      const down = Math.abs(light[i] - light[i + side])
      steps += across + down
      squares += across * across + down * down
      spread += Math.abs(light[i] - mean)
      n++
    }
  }
  return squares / (steps + 1) / (spread / n + 1)
}

/**
 * The camera's picture, made to look photographed and not streamed.
 *
 * `fine` and `coarse` are the same picture blurred a little and a lot. What a
 * pixel has over the first is edge; over the second, shape — the cheek against
 * the wall behind it — and a webcam's picture is short of both. Each is given
 * back, and then the range is opened out: `low` and `high` are the darkest and
 * lightest the picture really reaches, and become black and white.
 *
 * It was a three-by-three sharpen at 0.22 and eight per cent of contrast, and
 * beside a studio picture of the character the visitor still read as the soft
 * one. That kernel only sees one pixel either side, and what a webcam blurs
 * is wider than that.
 *
 * Three things are held back. A step smaller than `GRAIN` is noise, and is
 * not an edge to be raised. Shape is given back no more than `HALO` either
 * way, or a dark head against a bright ceiling grows a glowing rim. And the
 * range is never opened by more than a third, so a picture of a grey wall
 * does not become one of a black and white one.
 */
const GRAIN = 2
const HALO = 18

export function clarify(
  rgba: Uint8ClampedArray,
  fine: Uint8ClampedArray,
  coarse: Uint8ClampedArray,
  low: number,
  high: number,
  edge = 0.9,
  shape = 0.3,
): void {
  // Half of the way to black, not all of it: a face under ceiling lights is
  // already the darkest thing in the room.
  const floor = Math.min(low, 40) / 2
  const gain = Math.min(255 / Math.max(1, Math.max(high, 215) - floor), 4 / 3)
  for (let i = 0; i < rgba.length; i += 4) {
    for (let j = i; j < i + 3; j++) {
      const step = rgba[j] - fine[j]
      const crisp = Math.sign(step) * Math.max(0, Math.abs(step) - GRAIN)
      const body = clamp(rgba[j] - coarse[j], -HALO, HALO)
      rgba[j] = (rgba[j] + edge * crisp + shape * body - floor) * gain
    }
  }
}

