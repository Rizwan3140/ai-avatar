import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { bus } from '../bus/bus.ts'
import { shareSelfie } from '../provider/http.ts'
import { avatarFrame } from '../renderer/Mp4VideoRenderer.tsx'
import { useStore } from '../state/store.ts'
import { LOOKS, bounds, cutOut, meanColour, toneGains } from './selfie.ts'

/**
 * "Can I get a selfie with you?"
 *
 * They hold the pose, the panel counts three, two, one, and the visitor gets a
 * picture of the two of them in the room they are both standing in — which is
 * the illusion this cabinet exists for, handed over to take home.
 *
 * The picture is made here, in the browser: the camera frame, with the avatar
 * lifted off the white of their own footage and stood in front of it. Nothing
 * is sent anywhere to make it.
 *
 * The same rules as try-on, because it is the same legal object — a kiosk
 * photographing a member of the public:
 *
 * - The camera does not open until someone has read what happens and said yes.
 * - The frame is taken once and the camera stops that instant.
 * - Declining is a button the same size as accepting.
 * - Nothing is kept. Closing deletes it, and so does walking away: a stranger's
 *   face is not left on a shop window for the next person.
 * - It leaves the screen only if they press "share to my phone", which says
 *   what that means before they press it.
 */
type Stage = 'closed' | 'consent' | 'countdown' | 'result' | 'refused'

/** Portrait, the shape of a phone held upright. */
const WIDTH = 1080
const HEIGHT = 1620

/** How long a picture of somebody stays up with nobody touching it. */
const UNATTENDED = 120_000

const canvas = (width: number, height: number) =>
  Object.assign(document.createElement('canvas'), { width, height })

const PANEL =
  'bg-canvas/85 border-line/60 shadow-float rounded-[clamp(16px,1.8vh,60px)] border p-[clamp(14px,1.6vh,58px)] backdrop-blur-xl'
const YES = 'bg-ink text-label rounded-full px-[1.6em] py-[0.8em] font-medium text-white'
const NO =
  'border-line/80 text-label hover:bg-line/40 rounded-full border px-[1.6em] py-[0.8em] font-medium transition-colors'

type Layers = {
  room: HTMLCanvasElement
  /** The avatar, cut out and placed — as filmed, and leaned toward the room. */
  figure: HTMLCanvasElement | null
  toned: HTMLCanvasElement | null
}

export function Selfie() {
  const capability = useStore((s) => s.selfie)
  const name = useStore((s) => s.name)
  const [stage, setStage] = useState<Stage>('closed')
  const [count, setCount] = useState(3)
  const [look, setLook] = useState(LOOKS[0].id)
  const [picture, setPicture] = useState('')
  const [shared, setShared] = useState('')
  const [sharing, setSharing] = useState(false)
  const [problem, setProblem] = useState('')

  const video = useRef<HTMLVideoElement | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const layers = useRef<Layers | null>(null)
  const photo = useRef<Blob | null>(null)
  const url = useRef('')
  const painting = useRef(0)

  const open = stage !== 'closed'

  function stopCamera() {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }

  /** Everything that could outlive this, torn down in one place. */
  function close() {
    stopCamera()
    bus.emit('SELFIE_POSING', { posing: false })
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = ''
    photo.current = null
    layers.current = null
    setStage('closed')
    setPicture('')
    setShared('')
    setSharing(false)
    setProblem('')
    setLook(LOOKS[0].id)
  }

  useEffect(() => close, [])

  // Said or tapped, it opens the offer and stops there: a sentence is agreement
  // to see the offer, never agreement to be photographed.
  useEffect(
    () =>
      bus.on('SELFIE_REQUESTED', () => {
        if (useStore.getState().selfie.available) setStage((s) => (s === 'closed' ? 'consent' : s))
      }),
    [],
  )

  // The room emptied. Whoever comes next must not find the last visitor's face.
  useEffect(() => {
    const offs = [bus.on('SESSION_ENDED', close), bus.on('SESSION_SLEEP', close)]
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // And so must the visitor who simply walked off. Reset by anything they do.
  useEffect(() => {
    if (!open || stage === 'countdown') return
    const timer = setTimeout(close, UNATTENDED)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, look, shared, sharing])

  // The microphone is off while this is open, for the reason it is off during
  // try-on: they are posing and talking to whoever came with them, and none of
  // it is a question. Only a live conversation is muted, and only a mute still
  // standing is undone.
  useEffect(() => {
    if (!open) return
    const { status, muted } = useStore.getState()
    if (muted || !['listening', 'thinking', 'speaking'].includes(status)) return
    bus.emit('MIC_MUTED', { muted: true })
    return () => {
      if (useStore.getState().muted) bus.emit('MIC_MUTED', { muted: false })
    }
  }, [open])

  useEffect(() => {
    if (stage !== 'countdown') return
    if (count === 0) return shoot()
    const tick = setTimeout(() => setCount((c) => c - 1), 1000)
    return () => clearTimeout(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, count])

  async function start() {
    setProblem('')
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1440 } },
        audio: false,
      })
      stream.current = media
      setCount(3)
      setStage('countdown')
      // They lift the phone, if this avatar has footage of it.
      bus.emit('SELFIE_POSING', { posing: true })
    } catch {
      setProblem('The camera could not be opened. It may be in use, or not permitted here.')
      setStage('refused')
    }
  }

  /**
   * The avatar as they stand at this instant, off their white background and
   * placed where a taller friend leaning into a selfie would be: front left,
   * head near the top, cut off somewhere below the knee.
   */
  function standIn(): HTMLCanvasElement | null {
    const source = avatarFrame()
    if (!source) return null
    const natural =
      source instanceof HTMLVideoElement
        ? { width: source.videoWidth, height: source.videoHeight }
        : { width: source.naturalWidth, height: source.naturalHeight }
    const width = Math.min(natural.width, 1080)
    const height = Math.round((width * natural.height) / natural.width)
    const work = canvas(width, height)
    const ctx = work.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(source, 0, 0, width, height)

    let frame: ImageData
    try {
      frame = ctx.getImageData(0, 0, width, height)
    } catch {
      // Footage served from another origin cannot be read back. The selfie is
      // then the visitor alone, which is still a photograph.
      return null
    }
    cutOut(frame.data, width, height)
    const box = bounds(frame.data, width, height)
    if (!box) return null
    ctx.putImageData(frame, 0, 0)

    const placed = canvas(WIDTH, HEIGHT)
    const onto = placed.getContext('2d')!
    const tall = HEIGHT * 1.22
    const wide = (box.width * tall) / box.height
    onto.imageSmoothingQuality = 'high'
    onto.drawImage(
      work, box.x, box.y, box.width, box.height,
      WIDTH * 0.3 - wide / 2, HEIGHT * 0.07, wide, tall,
    )
    return placed
  }

  function shoot() {
    const camera = video.current
    if (!camera || !camera.videoWidth) {
      stopCamera()
      bus.emit('SELFIE_POSING', { posing: false })
      setProblem('The camera was not ready in time. Please try once more.')
      setStage('refused')
      return
    }

    // Mirrored, as the preview was: this is the picture they posed for. Filled
    // edge to edge, and slid so the middle of the camera's view lands right of
    // centre — the avatar is standing on the left.
    const room = canvas(WIDTH, HEIGHT)
    const ctx = room.getContext('2d', { willReadFrequently: true })!
    const scale = Math.max(WIDTH / camera.videoWidth, HEIGHT / camera.videoHeight)
    const wide = camera.videoWidth * scale
    const tall = camera.videoHeight * scale
    const left = Math.min(0, Math.max(WIDTH - wide, WIDTH * 0.64 - wide / 2))
    ctx.setTransform(-1, 0, 0, 1, left + wide, 0)
    ctx.drawImage(camera, 0, (HEIGHT - tall) / 2, wide, tall)
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    // While they are still holding the pose, and before anything else moves.
    const figure = standIn()
    // The instant the frame is taken. A camera left running behind a picture
    // is a recording light nobody agreed to.
    stopCamera()
    bus.emit('SELFIE_POSING', { posing: false })

    let toned: HTMLCanvasElement | null = null
    if (figure) {
      const pixels = figure.getContext('2d')!.getImageData(0, 0, WIDTH, HEIGHT)
      const gains = toneGains(
        meanColour(ctx.getImageData(0, 0, WIDTH, HEIGHT).data),
        meanColour(pixels.data),
      )
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (!pixels.data[i + 3]) continue
        pixels.data[i] *= gains[0]
        pixels.data[i + 1] *= gains[1]
        pixels.data[i + 2] *= gains[2]
      }
      toned = canvas(WIDTH, HEIGHT)
      toned.getContext('2d')!.putImageData(pixels, 0, 0)
    }

    layers.current = { room, figure, toned }
    setLook(LOOKS[0].id)
    setShared('')
    setStage('result')
    paint(LOOKS[0].id)
  }

  /** Lay the two layers down in one look, and show the result. */
  function paint(id: string) {
    const held = layers.current
    if (!held) return
    const style = LOOKS.find((l) => l.id === id) ?? LOOKS[0]
    const out = canvas(WIDTH, HEIGHT)
    const ctx = out.getContext('2d')!

    ctx.filter = style.filter ?? 'none'
    ctx.drawImage(held.room, 0, 0)
    if (held.figure && id === 'original') {
      // As filmed and simply placed: the honest paste.
      ctx.drawImage(held.figure, 0, 0)
    } else if (held.figure) {
      // Leaned toward the room's light, and casting a little of their own
      // shadow on it — the difference between standing there and a sticker.
      ctx.shadowColor = 'rgba(0, 0, 0, 0.32)'
      ctx.shadowBlur = 42
      ctx.shadowOffsetX = 14
      ctx.drawImage(held.toned ?? held.figure, 0, 0)
      ctx.shadowColor = 'transparent'
    }
    ctx.filter = 'none'
    if (style.tint) {
      ctx.globalCompositeOperation = 'soft-light'
      ctx.fillStyle = style.tint
      ctx.fillRect(0, 0, WIDTH, HEIGHT)
    }

    const turn = ++painting.current
    out.toBlob(
      (blob) => {
        // Closed, or overtaken by the next look, while this was encoding.
        if (!blob || turn !== painting.current || !layers.current) return
        if (url.current) URL.revokeObjectURL(url.current)
        url.current = URL.createObjectURL(blob)
        photo.current = blob
        setPicture(url.current)
      },
      'image/jpeg',
      0.9,
    )
  }

  function choose(id: string) {
    setLook(id)
    // A different look is a different picture; the code on screen is the old one.
    setShared('')
    paint(id)
  }

  async function share() {
    if (!photo.current) return
    setSharing(true)
    setProblem('')
    try {
      const id = await shareSelfie(photo.current)
      if (layers.current) setShared(id)
    } catch (failure) {
      if (layers.current) setProblem((failure as Error).message)
    } finally {
      setSharing(false)
    }
  }

  function again() {
    layers.current = null
    photo.current = null
    setPicture('')
    setShared('')
    void start()
  }

  if (!open) return null

  return createPortal(
    <>
      {stage === 'consent' && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-end px-safe pb-safe">
          <div className={`${PANEL} lay-down pointer-events-auto flex w-full flex-col gap-[1em]`}>
            <h2 className="font-display text-title leading-tight text-balance">
              A selfie with {name || 'me'}?
            </h2>
            <ul className="text-ink-soft text-label flex flex-col gap-[0.4em]">
              <li>The camera takes one photograph, after a count of three.</li>
              <li>It stays on this screen. It is not saved, and closing this deletes it.</li>
              {capability.share && (
                <li>
                  You can send it to your phone if you choose to. Only then is it uploaded,
                  and it is deleted after 24 hours.
                </li>
              )}
            </ul>
            <div className="flex flex-wrap gap-[0.7em]">
              <button type="button" onClick={() => void start()} className={YES}>
                Yes, take it
              </button>
              {/* The same size as yes. See TryOn. */}
              <button type="button" onClick={close} className={NO}>
                No thanks
              </button>
            </div>
          </div>
        </div>
      )}

      {stage === 'countdown' && (
        // Over them, not instead of them: they are holding the pose, and the
        // count sits on their chest the way it does on a phone's own timer.
        <div className="pointer-events-none absolute inset-0 z-30">
          <span
            key={count}
            aria-live="assertive"
            className="font-display absolute inset-x-0 top-[38%] animate-[rise_var(--duration-quick)_var(--ease-human)] text-center text-[clamp(140px,24vh,900px)] leading-none text-white"
            style={{ textShadow: '0 0.04em 0.2em rgba(0,0,0,0.4), 0 0 0.03em rgba(0,0,0,0.6)' }}
          >
            {count || ''}
          </span>
          {/* Themselves, small, so they can see they are in the frame.
              Mirrored, because an unmirrored self-view reads as someone else. */}
          <video
            ref={(element) => {
              video.current = element
              if (element && stream.current && element.srcObject !== stream.current) {
                element.srcObject = stream.current
              }
            }}
            autoPlay
            playsInline
            muted
            className="border-line/60 shadow-float absolute right-safe bottom-safe aspect-[3/4] w-[26%] -scale-x-100 rounded-[clamp(10px,1.1vh,36px)] border object-cover"
          />
          <button
            type="button"
            onClick={close}
            className={`${NO} bg-canvas/80 pointer-events-auto absolute bottom-safe left-safe backdrop-blur-md`}
          >
            Cancel
          </button>
        </div>
      )}

      {stage === 'result' && (
        <div className="bg-canvas/50 absolute inset-0 z-30 flex items-center justify-center px-safe py-safe backdrop-blur-sm">
          <div className={`${PANEL} lay-down flex max-h-full w-full max-w-[62vh] flex-col gap-[0.9em]`}>
            {picture ? (
              <img
                src={picture}
                alt={`You and ${name || 'the avatar'}`}
                className="min-h-0 flex-1 rounded-[clamp(10px,1.1vh,36px)] object-contain"
              />
            ) : (
              <div className="flex min-h-[30vh] flex-1 items-center justify-center gap-[0.4em]" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="bg-ink size-[0.6em] rounded-full"
                    style={{ animation: `dot 1.4s ${i * 0.16}s infinite` }}
                  />
                ))}
              </div>
            )}

            <div className="flex shrink-0 gap-[0.5em] overflow-x-auto">
              {LOOKS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => choose(id)}
                  aria-pressed={look === id}
                  className={`text-label shrink-0 rounded-full px-[1.1em] py-[0.5em] transition-colors ${
                    look === id ? 'bg-ink text-white' : 'text-ink-soft hover:bg-line/40'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex shrink-0 flex-col items-center gap-[0.6em] text-center">
              {shared ? (
                <>
                  {/* Drawn by the cabinet itself, like a product's. */}
                  <img
                    src={`/api/selfie/${encodeURIComponent(shared)}/qr`}
                    alt="A code to scan with your phone"
                    className="w-[clamp(120px,15vh,560px)]"
                  />
                  <p className="text-ink-soft text-label">
                    Scan to save your photo. It is deleted after 24 hours.
                  </p>
                </>
              ) : capability.share ? (
                <>
                  <button
                    type="button"
                    onClick={() => void share()}
                    disabled={sharing || !picture}
                    className={`${YES} w-full disabled:opacity-50`}
                  >
                    {sharing ? 'Sending…' : 'Share to my phone'}
                  </button>
                  <p className="text-ink-soft text-label">
                    Your photo will be uploaded so you can download it, and deleted after 24 hours.
                  </p>
                </>
              ) : (
                <p className="text-ink-soft text-label">
                  This picture is not saved anywhere. Take a photo of the screen to keep it.
                </p>
              )}
              {problem && <p className="text-label">{problem}</p>}
            </div>

            <div className="flex shrink-0 flex-wrap justify-center gap-[0.7em]">
              <button type="button" onClick={again} className={NO}>
                Take another selfie
              </button>
              <button type="button" onClick={close} className={NO}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {stage === 'refused' && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-end px-safe pb-safe">
          <div className={`${PANEL} lay-down pointer-events-auto flex w-full flex-col items-start gap-[1em]`}>
            <p className="text-body leading-relaxed text-balance">{problem}</p>
            <button type="button" onClick={close} className={NO}>
              Close
            </button>
          </div>
        </div>
      )}
    </>,
    document.querySelector('.kiosk-root') ?? document.body,
  )
}
