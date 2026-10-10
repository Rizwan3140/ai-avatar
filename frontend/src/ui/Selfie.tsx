import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { bus } from '../bus/bus.ts'
import { shareSelfie, type Character } from './booth.ts'
import { findFace, warmFaces } from './faces.ts'
import {
  LOOKS,
  arrange,
  bounds,
  cutOut,
  isCutOut,
  meanColour,
  toneGains,
  type Box,
} from './selfie.ts'

/**
 * A selfie with a character.
 *
 * They get ready, the panel counts down from eight, and the visitor gets a
 * picture of the two of them in the room the visitor is standing in.
 *
 * The picture is made here, in the browser: the camera frame, with the
 * character's cut-out picture sized to the visitor's own face and stood beside
 * them. Nothing is sent anywhere to make it.
 *
 * It knows nothing of the showroom. Who is in the picture arrives as `who` —
 * a name, a picture, whether sharing is possible — and there is no avatar, no
 * conversation and no microphone anywhere near it.
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

/**
 * Portrait, the shape of a phone held upright — and large. At 1080 across the
 * picture was enlarged to fill its card on a 2160-wide panel, and a webcam's
 * frame enlarged twice is the soft, "below average" picture it was called.
 */
const WIDTH = 1440
const HEIGHT = 2160

/** Seconds of count. Long enough for the clip of them getting ready — five or
 *  six seconds — to finish and be held, and for a visitor to stop laughing. */
const COUNT = 8

/** The avatar, cut out and ready to place, and where their face is in it. */
type Figure = { image: HTMLCanvasElement; face: Box | null }

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

export function Selfie({ who }: { who: Character }) {
  const name = who.name
  const [stage, setStage] = useState<Stage>('closed')
  const [count, setCount] = useState(COUNT)
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
  /** Being cut out while the count runs, so the shutter does not wait for it. */
  const figure = useRef<Promise<Figure | null> | null>(null)
  /** Which attempt this is. A picture still being composed when the visitor
   *  closed, or asked for another, belongs to nobody and is dropped. */
  const attempt = useRef(0)

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
    figure.current = null
    attempt.current++
    setStage('closed')
    setPicture('')
    setShared('')
    setSharing(false)
    setProblem('')
    setLook(LOOKS[0].id)
  }

  useEffect(() => close, [])

  // The tap opens the offer and stops there: it is agreement to see what is
  // being offered, never agreement to be photographed.
  useEffect(
    () => bus.on('SELFIE_REQUESTED', () => setStage((s) => (s === 'closed' ? 'consent' : s))),
    [],
  )

  // The visitor who simply walked off must not leave their face on a shop
  // window for whoever comes next. Reset by anything they do.
  useEffect(() => {
    if (!open || stage === 'countdown') return
    const timer = setTimeout(close, UNATTENDED)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, look, shared, sharing])

  useEffect(() => {
    if (stage !== 'countdown') return
    if (count === 0) return void shoot()
    const tick = setTimeout(() => setCount((c) => c - 1), 1000)
    return () => clearTimeout(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, count])

  async function start() {
    setProblem('')
    attempt.current++
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        // Everything the camera has. Asked for 1080 by 1440 a webcam answered
        // with its smallest mode that fits, and the middle third of that was
        // then stretched over the whole picture.
        video: { facingMode: 'user', width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      })
      stream.current = media
      setCount(COUNT)
      setStage('countdown')
      // They get ready, if they have a clip of it.
      bus.emit('SELFIE_POSING', { posing: true })
      // Both take a moment, and the count is a moment nobody is waiting in.
      warmFaces()
      figure.current = portrait()
    } catch {
      setProblem('The camera could not be opened. It may be in use, or not permitted here.')
      setStage('refused')
    }
  }

  /**
   * The character for the picture, cut out, and where their face is in it:
   * them as the phone sees them, arm out, close.
   */
  async function portrait(): Promise<Figure | null> {
    if (!who.picture) return null
    const source = new Image()
    source.src = who.picture
    try {
      await source.decode()
    } catch {
      // A picture that will not load is the same as not having one: the selfie
      // is then the visitor alone, which is still a photograph.
      return null
    }
    const natural = { width: source.naturalWidth, height: source.naturalHeight }
    if (!natural.width || !natural.height) return null
    const width = Math.min(natural.width, 1600)
    const height = Math.round((width * natural.height) / natural.width)
    const work = canvas(width, height)
    const ctx = work.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(source, 0, 0, width, height)

    const frame = ctx.getImageData(0, 0, width, height)
    // It should arrive with its background already gone, and cutting it again
    // would take the white of a shirt with it. One saved on its studio
    // backdrop still has that, and is cut out here as well as can be done.
    if (!isCutOut(frame.data)) cutOut(frame.data, width, height)
    const box = bounds(frame.data, width, height)
    if (!box) return null
    ctx.putImageData(frame, 0, 0)

    const image = canvas(box.width, box.height)
    image
      .getContext('2d')!
      .drawImage(work, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)

    // No face found is left to `arrange`, which knows where one is in a
    // picture taken from the phone.
    return { image, face: await findFace(image) }
  }

  async function shoot() {
    const camera = video.current
    if (!camera || !camera.videoWidth) {
      stopCamera()
      bus.emit('SELFIE_POSING', { posing: false })
      setProblem('The camera was not ready in time. Please try once more.')
      setStage('refused')
      return
    }
    const mine = attempt.current

    // The moment, at the camera's own size. Everything after this is
    // arithmetic on a picture that already exists.
    const shot = canvas(camera.videoWidth, camera.videoHeight)
    shot.getContext('2d')!.drawImage(camera, 0, 0)
    // The instant the frame is taken. A camera left running behind a picture
    // is a recording light nobody agreed to.
    stopCamera()
    bus.emit('SELFIE_POSING', { posing: false })
    setLook(LOOKS[0].id)
    setShared('')
    setStage('result')

    const [who, visitor] = await Promise.all([figure.current, findFace(shot)])
    if (mine !== attempt.current) return

    const place = arrange(
      { width: WIDTH, height: HEIGHT },
      shot,
      visitor,
      who?.image ?? { width: 1, height: 1 },
      who?.face ?? null,
    )

    // Mirrored, as the preview was: this is the picture they posed for.
    const room = canvas(WIDTH, HEIGHT)
    const ctx = room.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingQuality = 'high'
    ctx.setTransform(-1, 0, 0, 1, place.room.x + place.room.width, 0)
    ctx.drawImage(shot, 0, place.room.y, place.room.width, place.room.height)
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    let placed: HTMLCanvasElement | null = null
    let toned: HTMLCanvasElement | null = null
    if (who) {
      placed = canvas(WIDTH, HEIGHT)
      const onto = placed.getContext('2d', { willReadFrequently: true })!
      onto.imageSmoothingQuality = 'high'
      onto.drawImage(who.image, place.figure.x, place.figure.y, place.figure.width, place.figure.height)

      const pixels = onto.getImageData(0, 0, WIDTH, HEIGHT)
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

    layers.current = { room, figure: placed, toned }
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
      0.93,
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
      const id = await shareSelfie(photo.current, who.id)
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
              <li>The camera takes one photograph, after a count of {COUNT}.</li>
              <li>It stays on this screen. It is not saved, and closing this deletes it.</li>
              {who.share && (
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
            // Heavy and plain. The display face is a thin serif, and a thin
            // white numeral over a red saree was the hardest thing on the
            // panel to read at the one moment everybody is reading it.
            className="absolute inset-x-0 top-[38%] animate-[rise_var(--duration-quick)_var(--ease-human)] text-center text-[clamp(140px,24vh,900px)] leading-none font-bold text-white tabular-nums"
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

            {/* Wrapped, not scrolled: a scrollbar under a photograph on a shop
                window is a desktop control nobody there will drag. */}
            <div className="flex shrink-0 flex-wrap justify-center gap-[0.5em]">
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
              ) : who.share ? (
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
