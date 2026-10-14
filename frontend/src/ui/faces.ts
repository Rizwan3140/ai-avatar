import { bodyOf, type Body, type Box } from './selfie.ts'

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

/** MediaPipe and its WASM, loaded once for the face and pose finders both. */
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
  void poser()
}
type Poser = {
  detect(image: CanvasImageSource): { landmarks: { x: number; y: number; visibility?: number }[][] }
}

let posing: Promise<Poser | null> | null = null

/**
 * Google's pose landmarker (lite), the same MediaPipe as the face detector:
 * where a body's nose, shoulders, hips, knees and ankles are. The selfie fits
 * the character to the visitor by them (`selfie.fitBodies`), so whatever of
 * the visitor the photograph holds - to the knees, to the shoes - the
 * character is cut at the same place on their own body.
 */
function poser(): Promise<Poser | null> {
  posing ??= (async () => {
    try {
      const { vision, files } = await mediapipe()
      return (await vision.PoseLandmarker.createFromOptions(files as never, {
        baseOptions: { modelAssetPath: `${HOME}/pose_landmarker_lite.task` },
        runningMode: 'IMAGE',
        numPoses: 3,
      })) as unknown as Poser
    } catch (failure) {
      console.warn('pose finding is unavailable; the selfie sizes by the face alone:', failure)
      return null
    }
  })()
  return posing
}

/**
 * The body in a picture nearest `near` (the visitor's face; else the middle),
 * or null. Never thrown. Not waited for past `PATIENCE` unless `patient` - as
 * `findFace`, and for the same reason: the character's own body is known in
 * advance and worth waiting for, a visitor's is not worth a stalled shutter.
 */
export async function findBody(image: HTMLCanvasElement, near: Box | null, patient = false): Promise<Body | null> {
  const found = patient
    ? await poser()
    : await Promise.race([poser(), new Promise<null>((resolve) => setTimeout(() => resolve(null), PATIENCE))])
  if (!found) return null
  try {
    const { width, height } = image
    const middle = near ? near.x + near.width / 2 : width / 2
    let best: { x: number; y: number; visibility?: number }[] | null = null
    for (const pose of found.detect(image).landmarks) {
      if (!best || Math.abs(pose[0].x * width - middle) < Math.abs(best[0].x * width - middle)) best = pose
    }
    return best ? bodyOf(best, height, width) : null
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
export async function findFace(image: HTMLCanvasElement, quick = false, patient = false): Promise<Box | null> {
  // Waited for, but not for ever. The detector is thirteen megabytes, and a
  // panel that reaches this server down a tunnel may still be fetching it
  // when the shutter goes. A picture arranged without it is better than a
  // visitor watching three dots; the next one has it.
  //
  // Except the character's own face (`patient`). Not found, it is assumed
  // where a head-and-shoulders picture has it - a quarter of the height - and
  // a full-length character is then drawn a doll: on the panel, whose first
  // download of the detector outran this wait, a head-to-shoes picture came
  // out half the visitor's size with its head at their chest. It is waited
  // for in full; `detector()` gives null rather than hang if it cannot load.
  const found = patient
    ? await detector()
    : await Promise.race([
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
      if (best) return settle(found, image, settle(found, image, best))
    }
    return null
  } catch {
    return null
  }
}

/**
 * The face found, measured again from a square four times its height around
 * it - so every face is the same share of what the detector sees, near or far,
 * in a camera frame or a character's picture. The box as first found is not a
 * ruler: the detector draws a small face's box relatively larger, so it came
 * from whichever look found them. A visitor near the lens read 20 cm taller
 * than the same visitor further back, and a character's face measured 193
 * pixels in their picture and 271 once its empty edge was trimmed - so they
 * were drawn two thirds the size their height asked for.
 */
function settle(found: Detector, image: HTMLCanvasElement, face: Box): Box {
  const side = Math.round(face.height * 4)
  const left = face.x + face.width / 2 - side / 2
  const top = face.y + face.height / 2 - side / 2
  const view = document.createElement('canvas')
  view.width = view.height = side
  view.getContext('2d')!.drawImage(image, left, top, side, side, 0, 0, side, side)
  let best: { off: number; box: Box } | null = null
  for (const { boundingBox: box } of found.detect(view).detections) {
    if (!box) continue
    const off = Math.hypot(box.originX + box.width / 2 - side / 2, box.originY + box.height / 2 - side / 2)
    if (!best || off < best.off) best = { off, box: { x: left + box.originX, y: top + box.originY, width: box.width, height: box.height } }
  }
  return best?.box ?? face
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
