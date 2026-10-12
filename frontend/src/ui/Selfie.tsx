import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { bus } from '../bus/bus.ts'
import { keepSelfie, shareSelfie, type Character } from './booth.ts'
import { findFace, warmFaces } from './faces.ts'
import {
  LOOKS,
  arrange,
  bounds,
  centreCut,
  clarify,
  crispness,
  cutOut,
  frameFor,
  grade,
  tone,
  turned,
  turnFrom,
  isCutOut,
  meanColour,
  toneGains,
  type Box,
  type Turn,
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
 * - The camera opens when the visitor presses the camera, and not before. There
 *   was a card in between — "A selfie with …?", what would happen, yes and no —
 *   and the owner had it taken out: on a screen whose one button is a camera,
 *   pressing it is the asking. The count that follows has a Cancel on it, and
 *   is the visitor's eight seconds to change their mind.
 * - The frame is taken once and the camera stops that instant.
 * - Nothing is kept. Closing deletes it, and so does walking away: a stranger's
 *   face is not left on a shop window for the next person.
 * - It leaves the screen only if they press "share to my phone", which says
 *   what that means before they press it.
 */
type Stage = 'closed' | 'countdown' | 'result' | 'refused'

/** Seconds of count. Long enough for the clip of them getting ready — five or
 *  six seconds — to finish and be held, and for a visitor to stop laughing. */
const COUNT = 8

/** The avatar, cut out and ready to place, and where their face is in it. */
type Figure = { image: HTMLCanvasElement; face: Box | null }

/** How long a picture of somebody stays up with nobody touching it. */
const UNATTENDED = 120_000

const canvas = (width: number, height: number) =>
  Object.assign(document.createElement('canvas'), { width, height })

/**
 * A webcam stood on its side, so a wide camera takes a tall photograph with
 * nothing cut and nothing enlarged. The browser cannot know how a camera is
 * mounted, so it assumes how this cabinet's is — a quarter turn, 270, asked
 * for as the default once that mount had been tried — and is told otherwise
 * in the address: `/selfie?id=…&turn=0` for a camera the right way up, or 90
 * for one turned the other way. That browser remembers what it was told,
 * because the camera belongs to the machine the browser is on.
 */
const MOUNTED: Turn = 270
const TURN = (() => {
  const KEY = 'luxora.selfie.turn'
  try {
    const said = new URLSearchParams(location.search).get('turn')
    if (said !== null) localStorage.setItem(KEY, String(turnFrom(said)))
    const kept = localStorage.getItem(KEY)
    return kept === null ? MOUNTED : turnFrom(kept)
  } catch {
    return MOUNTED // no storage here to say otherwise
  }
})()

/** The camera's picture as it stands once turned. */
const upright = (camera: HTMLVideoElement) =>
  turned({ width: camera.videoWidth, height: camera.videoHeight }, TURN)

/** The photograph's shape and size for this camera — see `frameFor`. */
const frameOf = (camera: HTMLVideoElement) => frameFor(upright(camera))

/**
 * The camera's picture, cut to the photograph's shape — the middle of it, not
 * mirrored. One function for the preview and for the photograph, because they
 * have to be the same picture: the visitor poses with the one and is handed
 * the other. `across` is how wide to make it.
 */
function framed(camera: HTMLVideoElement, across: number, into?: HTMLCanvasElement): HTMLCanvasElement {
  const frame = frameOf(camera)
  const whole = upright(camera)
  const cut = centreCut(whole, frame)
  const width = Math.round(across)
  const height = Math.round((width * frame.height) / frame.width)
  const out = into ?? canvas(width, height)
  if (out.width !== width || out.height !== height) Object.assign(out, { width, height })
  const ctx = out.getContext('2d')!
  // The cut laid over the whole of `out`, and the camera stood up inside it.
  const by = width / cut.width
  ctx.setTransform(by, 0, 0, by, (whole.width / 2 - cut.x) * by, (whole.height / 2 - cut.y) * by)
  ctx.rotate((TURN * Math.PI) / 180)
  ctx.drawImage(camera, -camera.videoWidth / 2, -camera.videoHeight / 2)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return out
}

/** The camera's picture given its edge, shape and range back — `clarify`.
 *  The two blurs are the browser's, sized to the picture, not counted in
 *  pixels: a 4K camera's softness is twice as many pixels wide. */
function enhance(ctx: CanvasRenderingContext2D, width: number, height: number, by = 1) {
  const image = ctx.getImageData(0, 0, width, height)
  const blurred = (radius: number) =>
    softened(ctx.canvas, radius).getContext('2d')!.getImageData(0, 0, width, height).data
  const { low, high } = tone(image.data)
  clarify(image.data, blurred(width / 1000), blurred(width / 70), low, high, 0.9 * by, 0.3 * by)
  ctx.putImageData(image, 0, 0)
}

/** A softer copy of a layer. */
function softened(layer: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const out = canvas(layer.width, layer.height)
  const ctx = out.getContext('2d', { willReadFrequently: true })!
  ctx.filter = `blur(${radius}px)`
  ctx.drawImage(layer, 0, 0)
  return out
}

const SAMPLE = 96
let sample: HTMLCanvasElement | null = null

/** How crisp one face is, shrunk to a size every face is measured at. */
function faceCrispness(layer: HTMLCanvasElement, face: Box): number {
  sample ??= canvas(SAMPLE, SAMPLE)
  const ctx = sample.getContext('2d', { willReadFrequently: true })!
  ctx.clearRect(0, 0, SAMPLE, SAMPLE)
  ctx.drawImage(layer, face.x, face.y, face.width, face.height, 0, 0, SAMPLE, SAMPLE)
  return crispness(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data, SAMPLE)
}

/** Put the character where `arrange` said. */
function drawFigure(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  { figure: at }: ReturnType<typeof arrange>,
) {
  ctx.drawImage(image, at.x, at.y, at.width, at.height)
}

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
  // Which edge of the photograph they stand at. Theirs, and never changed.
  const side = who.side
  const [stage, setStage] = useState<Stage>('closed')
  const [count, setCount] = useState(COUNT)
  const [look, setLook] = useState(LOOKS[0].id)
  const [picture, setPicture] = useState('')
  const [shared, setShared] = useState('')
  const [sharing, setSharing] = useState(false)
  const [problem, setProblem] = useState('')
  /** The camera's size and the photograph's, for whoever is setting this up. */
  const [taken, setTaken] = useState('')
  /** What the camera gave, until this shot has been saved for tuning. */
  const keeping = useRef('')

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
  /** The picture as it will be taken, drawn live through the count. */
  const preview = useRef<HTMLCanvasElement | null>(null)
  /** The same `figure`, once it has arrived, for the preview to draw. */
  const ready = useRef<Figure | null>(null)
  /** A selfie is under way, from the press of the camera until it is closed. */
  const going = useRef(false)

  const open = stage !== 'closed'

  // The preview is the photograph, not a view of the camera.
  //
  // It was the camera's picture in a corner: the visitor alone, at one shape,
  // while the photograph was cut to another, slid, enlarged and given a second
  // person. They posed with one picture and were handed a different one. This
  // draws what `shoot` will draw — the same cut, the character placed by the
  // same `arrange` from a face found a few times a second — so where they are
  // standing, and where the character will stand beside them, is settled
  // before the shutter and not discovered after it.
  useEffect(() => {
    if (stage !== 'countdown') return
    const small = canvas(1, 1)
    let face: Awaited<ReturnType<typeof findFace>> = null
    let looking = false
    let looked = 0
    let next = 0
    const draw = (now: number) => {
      const camera = video.current
      const onto = preview.current
      if (camera?.videoWidth && onto) {
        // The preview takes the photograph's shape, which is the camera's to
        // decide: wide from a webcam, tall from one stood on its side.
        const frame = frameOf(camera)
        const wide = frame.width >= frame.height
        const across = wide ? 640 : 480
        const tall = Math.round((across * frame.height) / frame.width)
        if (onto.width !== across || onto.height !== tall) {
          Object.assign(onto, { width: across, height: tall })
          onto.style.aspectRatio = `${across} / ${tall}`
          onto.style.width = wide ? '46%' : '30%'
        }
        framed(camera, onto.width, small)
        const ctx = onto.getContext('2d')!
        // Mirrored, because an unmirrored self-view reads as someone else.
        ctx.setTransform(-1, 0, 0, 1, onto.width, 0)
        ctx.drawImage(small, 0, 0)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        const who = ready.current
        if (who) drawFigure(ctx, who.image, arrange(onto, small, face, who.image, who.face, side))
        if (!looking && now - looked > 350) {
          looking = true
          looked = now
          void findFace(small, true).then((found) => {
            face = found
            looking = false
          })
        }
      }
      next = requestAnimationFrame(draw)
    }
    next = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(next)
  }, [stage])

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
    ready.current = null
    going.current = false
    attempt.current++
    setStage('closed')
    setPicture('')
    setShared('')
    setSharing(false)
    setProblem('')
    setLook(LOOKS[0].id)
  }

  useEffect(() => close, [])

  // The camera button starts it: the camera opens and the count begins. Once,
  // however many times it is pressed while the camera is still opening.
  useEffect(
    () =>
      bus.on('SELFIE_REQUESTED', () => {
        if (going.current) return
        going.current = true
        void start()
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // Then its best mode, asked for by name. "Ideal" is a wish: some webcams
      // answer a wish for 4K with their 640 by 480 default, and a picture that
      // small enlarged to a photograph is blurred before anything else is
      // done to it. What the camera says it can do, it is told to do.
      const [track] = media.getVideoTracks()
      const can = track?.getCapabilities?.()
      if (can?.width?.max && can.height?.max) {
        await track
          .applyConstraints({ width: can.width.max, height: can.height.max })
          .catch(() => {})
      }
      setCount(COUNT)
      setStage('countdown')
      // They get ready, if they have a clip of it.
      bus.emit('SELFIE_POSING', { posing: true })
      // Both take a moment, and the count is a moment nobody is waiting in.
      warmFaces()
      const mine = attempt.current
      figure.current = portrait()
      void figure.current.then((who) => {
        if (mine === attempt.current) ready.current = who
      })
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

    // The moment, at the photograph's own size, cut exactly as the preview
    // was. Everything after this is arithmetic on a picture that already exists.
    const frame = frameOf(camera)
    const { width: WIDTH, height: HEIGHT } = frame
    const shot = framed(camera, WIDTH)
    // How much the camera needs. One enlarged to make the photograph is soft
    // and gets all of `enhance`; a 4K one shrunk to it is sharp already, and
    // given the same came out crunchy, with dark faces darker still.
    const needs = Math.min(1, Math.max(0.3, (WIDTH / centreCut(upright(camera), frame).width) ** 2))
    // What the camera actually gave. "I'm blurry, she is fine" has one cause
    // worth ruling out before any other, and it is a number: a camera handing
    // over 640 by 480 makes a soft photograph whatever is done afterwards.
    setTaken(`Camera: ${camera.videoWidth} × ${camera.videoHeight}. Photo: ${WIDTH} × ${HEIGHT}.`)
    keeping.current = `${camera.videoWidth}x${camera.videoHeight}${TURN ? `x${TURN}` : ''}`
    console.info('selfie:', camera.videoWidth, 'x', camera.videoHeight, 'camera ->', WIDTH, 'x', HEIGHT, 'photo')
    // The instant the frame is taken. A camera left running behind a picture
    // is a recording light nobody agreed to.
    stopCamera()
    bus.emit('SELFIE_POSING', { posing: false })
    setLook(LOOKS[0].id)
    setShared('')
    setStage('result')

    const [who, visitor] = await Promise.all([figure.current, findFace(shot)])
    if (mine !== attempt.current) return

    // Mirrored, as the preview was: this is the picture they posed for.
    //
    // And lifted a little. Beside a studio picture of the character a webcam's
    // frame is flat, thin and soft, and that gap — not the arrangement — is
    // what gave the first photographs from a real cabinet away. It is closed
    // from both ends: here the camera's picture is given colour, edge, shape
    // and range (`enhance`), and below the character is brought down to meet it.
    const room = canvas(WIDTH, HEIGHT)
    const ctx = room.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingQuality = 'high'
    ctx.filter = 'saturate(1.12)'
    ctx.setTransform(-1, 0, 0, 1, WIDTH, 0)
    ctx.drawImage(shot, 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.filter = 'none'
    enhance(ctx, WIDTH, HEIGHT, needs)

    let placed: HTMLCanvasElement | null = null
    let toned: HTMLCanvasElement | null = null
    if (who) {
      placed = canvas(WIDTH, HEIGHT)
      const onto = placed.getContext('2d', { willReadFrequently: true })!
      onto.imageSmoothingQuality = 'high'
      const place = arrange(frame, shot, visitor, who.image, who.face, side)
      drawFigure(onto, who.image, place)

      // Their colour leaned toward the room's cast, then their whole tonal
      // range brought most of the way to the room's: blacks as lifted, whites
      // as dull, colour as thin.
      const pixels = onto.getImageData(0, 0, WIDTH, HEIGHT)
      const around = ctx.getImageData(0, 0, WIDTH, HEIGHT).data
      const gains = toneGains(meanColour(around), meanColour(pixels.data))
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (!pixels.data[i + 3]) continue
        pixels.data[i] *= gains[0]
        pixels.data[i + 1] *= gains[1]
        pixels.data[i + 2] *= gains[2]
      }
      // Less than half the way. At 0.65 their blacks were lifted far enough
      // to look like haze over them, which is its own kind of blur.
      grade(pixels.data, tone(pixels.data), tone(around), 0.4)
      const graded = canvas(WIDTH, HEIGHT)
      graded.getContext('2d')!.putImageData(pixels, 0, 0)

      // Then as sharp as the visitor is, and no sharper. Their face and the
      // visitor's are each measured at the same small size, and theirs is
      // softened a step at a time until it is no crisper — a face is what the
      // eye sets beside a face. With no visitor's face to measure against, a
      // little, which is what a webcam costs.
      const k = place.figure.width / who.image.width
      const theirs = who.face && {
        x: place.figure.x + who.face.x * k,
        y: place.figure.y + who.face.y * k,
        width: who.face.width * k,
        height: who.face.height * k,
      }
      // The visitor's face, mirrored into the picture as the room was.
      const visitors = visitor && { ...visitor, x: WIDTH - visitor.x - visitor.width }
      toned = theirs && visitors ? graded : softened(graded, 0.5)
      if (theirs && visitors) {
        const wanted = faceCrispness(room, visitors) * 1.3
        // A touch, and no more. This went to 2.4 pixels and nearly always got
        // there: their face is a close-up and the visitor's is across the
        // room, and a small face shrunk to the measuring size keeps less
        // detail than a large one, so they read as far too sharp every time.
        // "it's coming as blurry." The measure can only be trusted to say
        // *that* they are crisper, not by how much.
        for (const radius of [0.5, 0.9]) {
          if (faceCrispness(toned, theirs) <= wanted) break
          toned = softened(graded, radius)
        }
      }
    }

    layers.current = { room, figure: placed, toned }
    paint(LOOKS[0].id)
  }

  /** Lay the two layers down in one look, and show the result. */
  function paint(id: string) {
    const held = layers.current
    if (!held) return
    const style = LOOKS.find((l) => l.id === id) ?? LOOKS[0]
    const { width: WIDTH, height: HEIGHT } = held.room
    const out = canvas(WIDTH, HEIGHT)
    const ctx = out.getContext('2d')!

    ctx.filter = style.filter ?? 'none'
    ctx.drawImage(held.room, 0, 0)
    if (held.figure && id === 'original') {
      // As filmed and simply placed: the honest paste.
      ctx.drawImage(held.figure, 0, 0)
    } else if (held.figure) {
      // Leaned toward the room's light, and nothing else. This also cast a
      // soft shadow from their whole outline, to stop them looking like a
      // sticker — and a dark edge all the way round a cut-out is precisely
      // what a sticker has. Somebody standing in a room throws a shadow on
      // the floor behind them, not a halo on the air beside them.
      ctx.drawImage(held.toned ?? held.figure, 0, 0)
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
        if (who.keep && keeping.current) keepSelfie(blob, who.id, keeping.current)
        keeping.current = ''
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
          {/* The camera, playing but not shown: the preview below is drawn
              from it. In the page and a pixel across rather than hidden,
              because a browser may stop feeding a video it is not laying out. */}
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
            aria-hidden
            className="absolute size-px opacity-0"
          />
          {/* The photograph as it will be taken — see the effect that draws it. */}
          <canvas
            ref={preview}
            // Sized and shaped by the effect that draws it, once the camera
            // has said what shape its picture is.
            width={640}
            height={480}
            aria-label="A preview of your selfie"
            className="border-line/60 shadow-float absolute right-safe bottom-safe aspect-[4/3] w-[46%] rounded-[clamp(10px,1.1vh,36px)] border"
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
                // Shown on hover: the sizes, for the person setting it up.
                title={taken}
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
            {/* Whoever is in it is told, because whoever is in it was not asked. */}
            {who.keep && (
              <p className="text-ink-soft text-label shrink-0 text-center">
                Test mode: this photo is saved on this machine.
              </p>
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
