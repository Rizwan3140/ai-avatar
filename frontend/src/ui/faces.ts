import type { Box } from './selfie.ts'

/**
 * Where the face is in a picture.
 *
 * A selfie with the avatar needs to know how big the visitor is in the frame
 * and where their head is, or the avatar is pasted at one size beside a
 * visitor who is anywhere from a face filling the frame to a figure across the
 * room — and the picture looks like what it is.
 *
 * The browser has a `FaceDetector` of its own and it is behind a flag, so on
 * the Chrome a cabinet actually runs it is not there. This is MediaPipe's:
 * the one runtime dependency the panel has taken, because the alternative was
 * guessing a head from skin colour. Served from this machine
 * (`public/facefinder`), so it works with the network down, and loaded only
 * when the selfie screen asks — the showroom never downloads it.
 *
 * It never throws. No face, no detector, a model that failed to load: all are
 * `null`, and the selfie falls back to an arrangement that assumes an
 * ordinary distance.
 */
type Detector = {
  detect(image: CanvasImageSource): {
    detections: { boundingBox?: { originX: number; originY: number; width: number; height: number } }[]
  }
}

const HOME = '/facefinder'

/** How long a picture waits for the detector to finish loading. */
const PATIENCE = 6000

let loading: Promise<Detector | null> | null = null
let runtime: Promise<{ vision: typeof import('@mediapipe/tasks-vision'); files: unknown }> | null = null

/** MediaPipe and its WASM, loaded once for the face detector and the
 *  segmenter both. */
function mediapipe() {
  runtime ??= (async () => {
    const vision = await import('@mediapipe/tasks-vision')
    return { vision, files: await vision.FilesetResolver.forVisionTasks(HOME) }
  })()
  return runtime
}

function detector(): Promise<Detector | null> {
  loading ??= (async () => {
    try {
      const { vision, files } = await mediapipe()
      return (await vision.FaceDetector.createFromOptions(files as never, {
        baseOptions: { modelAssetPath: `${HOME}/blaze_face_short_range.tflite` },
        runningMode: 'IMAGE',
      })) as unknown as Detector
    } catch (failure) {
      console.warn('face detection is unavailable; the selfie uses a fixed arrangement:', failure)
      return null
    }
  })()
  return loading
}

/** Start loading both, so the wait is spent during the count and not after it. */
export function warmFaces(): void {
  void detector()
  void segmenter()
}
/** Where the person is, pixel by pixel: 0 for the room, 1 for them. At the
 *  model's own size, which is smaller than the picture. */
export type Person = { mask: Float32Array; width: number; height: number }

type Segmenter = {
  segment(image: CanvasImageSource): {
    confidenceMasks?: { width: number; height: number; getAsFloat32Array(): Float32Array }[]
    close(): void
  }
}

let cutting: Promise<Segmenter | null> | null = null

/**
 * Google's selfie segmenter, the same MediaPipe as the face detector and a
 * quarter of a megabyte more. Used for one thing: where the visitor's feet
 * are, so a character can stand on the same floor (`selfie.groundOf`). It
 * once also blurred the room behind them; that look was taken off.
 */
function segmenter(): Promise<Segmenter | null> {
  cutting ??= (async () => {
    try {
      const { vision, files } = await mediapipe()
      return (await vision.ImageSegmenter.createFromOptions(files as never, {
        baseOptions: { modelAssetPath: `${HOME}/selfie_segmenter.tflite` },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      })) as unknown as Segmenter
    } catch (failure) {
      console.warn('person segmentation is unavailable; the selfie sizes by the face alone:', failure)
      return null
    }
  })()
  return cutting
}

/** The person in a picture, or null — never thrown, and not waited for past
 *  `PATIENCE`, for the reasons `findFace` gives. */
export async function findPerson(image: HTMLCanvasElement): Promise<Person | null> {
  const found = await Promise.race([
    segmenter(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), PATIENCE)),
  ])
  if (!found) return null
  try {
    const result = found.segment(image)
    const [first] = result.confidenceMasks ?? []
    const person = first && { mask: first.getAsFloat32Array().slice(), width: first.width, height: first.height }
    result.close()
    return person ?? null
  } catch {
    return null
  }
}


/**
 * The visitor's face — large, and near the middle — or null.
 *
 * Not simply the largest. That was the rule, and it photographed the wrong
 * man: somebody passing at the edge of the frame, nearer the lens than the
 * visitor posing in the middle of it. Whoever is having their picture taken
 * stands in front of the camera, so a face counts for less the further it is
 * from the centre line, down to a fifth at the very edge.
 *
 * `quick` is for the preview, many times a second: one look at the whole
 * picture, and no waiting for a detector that has not finished loading.
 *
 * Otherwise looked for three times, closer each time, stopping at the first look that
 * finds anybody. The model sees every picture shrunk to 128 pixels square, and
 * was made for a face held at arm's length: in a whole webcam frame, somebody
 * standing two metres back is a face five pixels tall, and it finds nothing —
 * which is exactly the visitor the sizing exists for. So after the whole
 * frame it is shown the frame in squares, and then in squares half that size,
 * where the same face is twenty pixels and plain.
 */
export async function findFace(image: HTMLCanvasElement, quick = false): Promise<Box | null> {
  // Waited for, but not for ever. The detector is thirteen megabytes, and a
  // panel that reaches this server down a tunnel may still be fetching it
  // when the shutter goes. A picture arranged without it is better than a
  // visitor watching three dots; the next one has it.
  const found = await Promise.race([
    detector(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), quick ? 0 : PATIENCE)),
  ])
  if (!found) return null
  const { width, height } = image
  const short = Math.min(width, height)
  const weight = (face: Box) => {
    const off = Math.min(1, Math.abs(face.x + face.width / 2 - width / 2) / (width / 2))
    return face.width * face.height * (1 - 0.8 * off * off)
  }
  try {
    for (const side of quick ? [0] : [0, short, Math.round(short / 2)]) {
      let best: Box | null = null
      for (const [x, y, size] of side ? tiles(width, height, side) : [[0, 0, 0] as const]) {
        const view = size ? crop(image, x, y, size) : image
        for (const { boundingBox: box } of found.detect(view).detections) {
          if (!box) continue
          const face = { x: x + box.originX, y: y + box.originY, width: box.width, height: box.height }
          if (!best || weight(face) > weight(best)) best = face
        }
      }
      if (best) return best
    }
    return null
  } catch {
    return null
  }
}

/** Squares of one size covering the picture, each overlapping the next by
 *  half, so a face on a seam is whole in the square beside it. */
function tiles(width: number, height: number, side: number): [number, number, number][] {
  const along = (length: number) => {
    const starts = [0]
    for (let at = side / 2; at + side < length; at += side / 2) starts.push(Math.round(at))
    if (length > side) starts.push(length - side)
    return starts
  }
  return along(height).flatMap((y) => along(width).map((x) => [x, y, side] as [number, number, number]))
}

let scratch: HTMLCanvasElement | null = null

function crop(image: HTMLCanvasElement, x: number, y: number, side: number): HTMLCanvasElement {
  scratch ??= document.createElement('canvas')
  scratch.width = scratch.height = side
  scratch.getContext('2d')!.drawImage(image, x, y, side, side, 0, 0, side, side)
  return scratch
}
