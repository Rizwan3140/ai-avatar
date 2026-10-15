import { useEffect, useState } from 'react'
import { bus } from '../bus/bus.ts'
import { useStore } from '../state/store.ts'
import { mediapipe } from './faces.ts'
import { type Hand, type Hold, gesturesOn, poseOf, reader } from './gestures.ts'
import { upright } from './TryOn.tsx'

/**
 * The shelf, worked from the air: a cursor that follows a raised finger, and
 * the gestures in `gestures.ts`. The point is fewer hands on a glass panel
 * the whole street touches.
 *
 * The camera is the one try-on and the selfie already use, asked for in the
 * same shape so that opening try-on shares it rather than fighting over it.
 * Its frames are read here, in the browser, and dropped: nothing is drawn,
 * kept or sent. `?gestures=0` switches it off on a machine.
 */

/**
 * The part of the camera's picture a hand moves in, stretched over the whole
 * screen - a visitor at arm's length reaches about this much of a webcam's
 * view, not all of it. Fractions of the upright picture, as seen by the
 * visitor. The knob to turn if the cursor cannot reach a corner (widen it)
 * or races across the screen (narrow it); set at a desk, not at the cabinet.
 */
const REACH = { left: 0.2, right: 0.8, top: 0.15, bottom: 0.65 }
/** About fifteen looks a second: enough for a cursor, little enough to leave
 *  the machine its videos. */
const EVERY = 66
/** What a held finger can press. */
const PRESSABLE = 'button:not(:disabled), a[href], [role="button"]'

type Cursor = { x: number; y: number; hold?: Hold }

export function AirHand() {
  const [cursor, setCursor] = useState<Cursor | null>(null)

  useEffect(() => {
    if (!gesturesOn() || !navigator.mediaDevices?.getUserMedia) return
    let stopped = false
    let timer = 0
    let stream: MediaStream | null = null
    let recognizer: { close(): void } | null = null
    let over: Element | null = null
    let smooth: { x: number; y: number } | null = null
    let announced = 0
    const step = reader()
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true })
    const canvas = document.createElement('canvas')

    const hover = (el: Element | null) => {
      if (el === over) return
      over?.removeAttribute('data-air')
      el?.setAttribute('data-air', '')
      over = el
    }

    void (async () => {
      try {
        const { vision, files } = await mediapipe()
        // The graphics card or nothing. Measured: 12 ms a look on it, 106 ms
        // on the processor - which is the avatar's video stopping ten times
        // a second, and a frozen frame reads instantly as software. Without
        // one this throws and the panel stays touch only.
        const found = await vision.GestureRecognizer.createFromOptions(files as never, {
          baseOptions: { modelAssetPath: '/facefinder/gesture_recognizer.task', delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 1,
        })
        recognizer = found
        if (stopped) return found.close()
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        })
        if (stopped) return stream.getTracks().forEach((t) => t.stop())
        video.srcObject = stream
        await video.play()

        const tick = () => {
          if (stopped) return
          timer = window.setTimeout(tick, EVERY)
          if (video.readyState < 2) return
          // Upright and mirrored, so the visitor's hand moving left is the
          // cursor moving left.
          upright(video, canvas, 480, true)
          const now = performance.now()
          const seen = found.recognizeForVideo(canvas, now)
          const points = seen.landmarks[0]
          if (points && now - announced > 1000) {
            announced = now
            bus.emit('HAND_SEEN') // keeps the cabinet awake, and wakes it
          }
          if (useStore.getState().status === 'sleeping') {
            hover(null)
            return setCursor(null)
          }

          const hand = points ? handOf(points, seen.gestures[0]?.[0]?.categoryName ?? 'None', canvas) : null
          if (hand) {
            smooth = smooth ? { x: smooth.x + (hand.x - smooth.x) * 0.45, y: smooth.y + (hand.y - smooth.y) * 0.45 } : hand
          } else smooth = null
          const target =
            hand?.pose === 'point' && smooth
              ? (document.elementFromPoint(smooth.x * innerWidth, smooth.y * innerHeight)?.closest(PRESSABLE) ?? null)
              : null
          hover(target)

          const { fire, hold } = step(now, hand, target)
          if (fire?.kind === 'tap') (target as HTMLElement | null)?.click()
          else if (fire?.kind === 'back') document.querySelector<HTMLElement>('[data-back]')?.click()
          else if (fire?.kind === 'talk') talk()
          else if (fire?.kind === 'swipe') swipe(fire.dir)
          const at = smooth
          setCursor((last) => (at ? { ...at, hold } : hold && last ? { ...last, hold } : null))
        }
        tick()
      } catch (failure) {
        console.warn('hand gestures are unavailable; the panel is touch only:', failure)
      }
    })()

    return () => {
      stopped = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
      recognizer?.close()
      hover(null)
    }
  }, [])

  if (!cursor) return null
  const filled = Math.min(1, cursor.hold?.progress ?? 0)
  const said = cursor.hold?.kind === 'back' ? 'Back' : cursor.hold?.kind === 'talk' ? 'Talk' : ''

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-[0.4em]"
      style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
    >
      {/* A ring that fills while a hold counts down, so nothing happens that
          the visitor did not watch coming. */}
      <span
        className="shadow-float grid size-[clamp(36px,3.2vh,120px)] place-items-center rounded-full border-2 border-white"
        style={{
          background: `conic-gradient(var(--color-accent) ${filled * 360}deg, color-mix(in oklab, var(--color-ink) 30%, transparent) 0)`,
        }}
      >
        <span className="size-[30%] rounded-full bg-white" />
      </span>
      {said && <span className="text-label bg-ink rounded-full px-[0.8em] py-[0.2em] text-white">{said}</span>}
    </div>
  )
}

/** A hand on the screen, or null when it is outside the reach - hanging at
 *  the visitor's side, or somebody else's in the background. */
function handOf(points: { x: number; y: number }[], category: string, picture: HTMLCanvasElement): Hand | null {
  const fit = (p: { x: number; y: number }) => ({
    x: (p.x - REACH.left) / (REACH.right - REACH.left),
    y: (p.y - REACH.top) / (REACH.bottom - REACH.top),
  })
  const tip = fit(points[8])
  const wrist = fit(points[0])
  if (tip.x < -0.05 || tip.x > 1.05 || tip.y < -0.05 || tip.y > 1.05) return null
  // In pixels, so a tall picture does not stretch the fingers for `poseOf`.
  const pose = poseOf(
    category,
    points.map((p) => ({ x: p.x * picture.width, y: p.y * picture.height })),
  )
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return { x: clamp(tip.x), y: clamp(tip.y), wx: wrist.x, wy: wrist.y, pose }
}

/** A sweep: the next or previous piece when one is open, else the row along
 *  by a screenful. */
function swipe(dir: 1 | -1) {
  const { products, selected } = useStore.getState()
  if (selected && products.length > 1) {
    const i = products.findIndex((p) => p.id === selected.id)
    const product = products[(i + dir + products.length) % products.length]
    return bus.emit('PRODUCT_SELECTED', { product })
  }
  const row = document.querySelector<HTMLElement>('[data-row]')
  row?.scrollBy({ left: dir * row.clientWidth, behavior: 'smooth' })
}

/** The microphone button's own job: open the conversation, or unmute it. */
function talk() {
  const { status, muted } = useStore.getState()
  if (muted) bus.emit('MIC_MUTED', { muted: false })
  else if (status === 'idle') bus.emit('SESSION_STARTED')
}
