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

export type Look = {
  id: string
  label: string
  /** A canvas filter over the whole picture. */
  filter?: string
  /** A colour laid over it in soft light. */
  tint?: string
}

/** The looks the visitor chooses between, in the order they are offered. */
export const LOOKS: Look[] = [
  { id: 'realistic', label: 'Realistic' },
  { id: 'original', label: 'Original' },
  { id: 'bw', label: 'B&W', filter: 'grayscale(1) contrast(1.08)' },
  { id: 'vivid', label: 'Vivid', filter: 'saturate(1.45) contrast(1.08)' },
  { id: 'warm', label: 'Warm', filter: 'saturate(1.1)', tint: 'rgba(255, 150, 60, 0.22)' },
  { id: 'cool', label: 'Cool', filter: 'saturate(1.05)', tint: 'rgba(70, 150, 255, 0.22)' },
]
