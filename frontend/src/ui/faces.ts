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

let loading: Promise<Detector | null> | null = null

function detector(): Promise<Detector | null> {
  loading ??= (async () => {
    try {
      const vision = await import('@mediapipe/tasks-vision')
      const files = await vision.FilesetResolver.forVisionTasks(HOME)
      return (await vision.FaceDetector.createFromOptions(files, {
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

/** Start loading it, so the wait is spent during the count and not after it. */
export function warmFaces(): void {
  void detector()
}

/**
 * The largest face — the person nearest the lens — or null.
 *
 * Looked for three times, closer each time, stopping at the first look that
 * finds anybody. The model sees every picture shrunk to 128 pixels square, and
 * was made for a face held at arm's length: in a whole webcam frame, somebody
 * standing two metres back is a face five pixels tall, and it finds nothing —
 * which is exactly the visitor the sizing exists for. So after the whole
 * frame it is shown the frame in squares, and then in squares half that size,
 * where the same face is twenty pixels and plain.
 */
export async function findFace(image: HTMLCanvasElement): Promise<Box | null> {
  const found = await detector()
  if (!found) return null
  const { width, height } = image
  const short = Math.min(width, height)
  try {
    for (const side of [0, short, Math.round(short / 2)]) {
      let best: Box | null = null
      for (const [x, y, size] of side ? tiles(width, height, side) : [[0, 0, 0] as const]) {
        const view = size ? crop(image, x, y, size) : image
        for (const { boundingBox: box } of found.detect(view).detections) {
          if (!box) continue
          if (!best || box.width * box.height > best.width * best.height) {
            best = { x: x + box.originX, y: y + box.originY, width: box.width, height: box.height }
          }
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
