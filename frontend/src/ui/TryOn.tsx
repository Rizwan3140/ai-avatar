import { useEffect, useRef, useState } from 'react'
import { bus } from '../bus/bus.ts'
import type { Product } from '../bus/events.ts'
import { tryOnProduct } from '../provider/http.ts'
import { useStore } from '../state/store.ts'

/**
 * "Would you like to see how this looks on you?"
 *
 * A photo in, a photo out. Nothing here touches the conversation stack — not the
 * event bus, not the renderer, not barge-in — which is exactly why this feature
 * could be built without waiting for any of them.
 *
 * **A kiosk that photographs members of the public is a different legal object
 * from one that answers questions.** Under India's DPDP Act and the GDPR that
 * needs an answer before the first demo, and the answer is enforced here as well
 * as on the server:
 *
 * - The camera does not open until someone has read what happens and said yes.
 * - The frame lives in a `Blob` and an object URL, is revoked on close, and is
 *   never uploaded anywhere except the one request that transforms it.
 * - Declining is a button of the same size as accepting, not a corner cross.
 * - Nothing is kept. Walking away is the delete button, and it is automatic.
 *
 * The server refuses without an explicit consent flag, so a future caller that
 * forgets this component cannot quietly skip the step.
 */
type Stage = 'consent' | 'camera' | 'working' | 'result' | 'refused'

export function TryOn({ product }: { product: Product }) {
  const capability = useStore((s) => s.tryon)
  const [stage, setStage] = useState<Stage>('consent')
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState('')
  const [problem, setProblem] = useState('')

  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const objectUrl = useRef('')

  /** Everything that could outlive this dialogue, torn down in one place. */
  function release() {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = ''
  }

  useEffect(() => release, [])

  // A visitor moving to a different product must not leave a camera running or
  // the previous person's result on screen.
  useEffect(() => {
    close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id])

  // "Can I try that on?" — spoken, which is how a visitor in a showroom actually
  // asks. It opens the consent screen and stops there: a sentence is agreement to
  // see the offer, never agreement to be photographed.
  useEffect(
    () =>
      bus.on('TRYON_REQUESTED', ({ product: wanted }) => {
        if (wanted.id === product.id) setOpen(true)
      }),
    [product.id],
  )

  function close() {
    release()
    setOpen(false)
    setStage('consent')
    setResult('')
    setProblem('')
  }

  async function startCamera() {
    setProblem('')
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        // Front-facing and portrait: a garment swap needs the person standing,
        // and the cabinet is a vertical panel.
        video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1440 } },
        audio: false,
      })
      stream.current = media
      setStage('camera')
      // The element only exists once the stage has rendered.
      queueMicrotask(() => {
        if (video.current) video.current.srcObject = media
      })
    } catch {
      setProblem('The camera could not be opened. It may be in use, or not permitted here.')
      setStage('refused')
    }
  }

  async function capture() {
    const element = video.current
    if (!element) return

    const canvas = document.createElement('canvas')
    canvas.width = element.videoWidth
    canvas.height = element.videoHeight
    canvas.getContext('2d')?.drawImage(element, 0, 0)

    const photo = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    )
    // Stop the camera the instant the frame is taken. Leaving it live through a
    // thirty-second render is a recording light nobody consented to.
    release()
    if (!photo) return setProblem('That frame could not be captured.')

    setStage('working')
    try {
      const swapped = await tryOnProduct(product.id, photo)
      objectUrl.current = URL.createObjectURL(swapped)
      setResult(objectUrl.current)
      setStage('result')
    } catch (failure) {
      setProblem((failure as Error).message)
      setStage('refused')
    }
  }

  // No provider, or no image on the product to put on anyone. Offering a button
  // that can only fail is worse than not offering one.
  if (!capability.available || !product.image) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-line px-4 py-2 text-sm transition-colors hover:bg-line/40"
      >
        See it on you
      </button>
    )
  }

  return (
    <div className="animate-[rise_var(--duration-quick)_var(--ease-human)] absolute inset-0 z-30 flex flex-col gap-5 bg-canvas px-safe py-safe">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight text-balance">{product.name}</h2>
        <button
          type="button"
          onClick={close}
          className="text-ink-soft shrink-0 rounded-full border border-line px-3 py-1.5 text-xs transition-colors hover:bg-line/40"
        >
          Close
        </button>
      </div>

      {stage === 'consent' && (
        <div className="flex flex-1 flex-col justify-center gap-6">
          <div className="flex flex-col gap-3">
            <p className="text-lg leading-relaxed text-balance">
              We can show you how this looks on you. That means taking one photograph.
            </p>
            <ul className="text-ink-soft flex flex-col gap-1.5 text-sm">
              <li>The photo is used once, to make the picture, and then discarded.</li>
              <li>It is never saved, never shown to staff, and never used to identify you.</li>
              <li>
                {capability.on_device
                  ? 'It does not leave this cabinet.'
                  : 'It is sent to our image service to be processed, and kept by nobody.'}
              </li>
              <li>Walking away deletes it. So does closing this.</li>
            </ul>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={startCamera}
              className="bg-ink rounded-full px-6 py-3 text-sm font-medium text-white"
            >
              Yes, take a photo
            </button>
            {/* The same size as the accept button. A decline that is a small grey
                corner cross is not a choice being offered in good faith. */}
            <button
              type="button"
              onClick={close}
              className="rounded-full border border-line px-6 py-3 text-sm font-medium transition-colors hover:bg-line/40"
            >
              No thanks
            </button>
          </div>
        </div>
      )}

      {stage === 'camera' && (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            // Mirrored, because an unmirrored self-view reads as someone else.
            className="min-h-0 flex-1 -scale-x-100 rounded-lg bg-line/30 object-cover"
          />
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={capture}
              className="bg-ink rounded-full px-6 py-3 text-sm font-medium text-white"
            >
              Take the photo
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded-full border border-line px-6 py-3 text-sm font-medium transition-colors hover:bg-line/40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === 'working' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <div className="flex gap-1.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="bg-ink h-2 w-2 rounded-full"
                style={{ animation: `dot 1.4s ${i * 0.16}s infinite` }}
              />
            ))}
          </div>
          <p className="text-ink-soft text-sm">Just a few seconds.</p>
        </div>
      )}

      {stage === 'result' && (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <img
            src={result}
            alt={`You wearing the ${product.name}`}
            className="min-h-0 flex-1 rounded-lg object-contain"
          />
          <p className="text-ink-soft text-sm">
            This picture is not saved anywhere. Take a photo of the screen if you want to keep it.
          </p>
          <button
            type="button"
            onClick={close}
            className="bg-ink self-start rounded-full px-6 py-3 text-sm font-medium text-white"
          >
            Done
          </button>
        </div>
      )}

      {stage === 'refused' && (
        <div className="flex flex-1 flex-col justify-center gap-4">
          <p className="text-lg leading-relaxed text-balance">{problem}</p>
          <button
            type="button"
            onClick={close}
            className="self-start rounded-full border border-line px-6 py-3 text-sm font-medium transition-colors hover:bg-line/40"
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
