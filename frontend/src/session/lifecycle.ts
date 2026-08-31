import { bus } from '../bus/bus.ts'
import { mp4Renderer } from '../renderer/Mp4VideoRenderer.tsx'
import config, { KIOSK_ID } from '../renderer/renderer.config.ts'
import { setAvatarMedia } from '../renderer/renderer.avatar.ts'
import type { Pose } from '../renderer/renderer.types.ts'
import { fetchAvatar, fetchKiosk, resetConversation } from '../provider/http.ts'
import { setIdentity, setTryOn, useStore } from '../state/store.ts'
import { applySeason } from './season.ts'
import * as voice from '../voice/voice.ts'
import { sessionId } from './session.ts'

// Imported for their bus subscriptions. Nobody holds a reference to anybody.
import '../conversation/conversation.ts'
import './session.ts'

/**
 * Session lifecycle.
 *
 *   BOOT → INITIALIZING → IDLE ⇄ CONVERSATION → END → IDLE → SLEEP ⇄ WAKE
 *
 * A kiosk runs for months, not for the length of a demo.
 */
export async function boot(): Promise<void> {
  bus.emit('SYSTEM_BOOT')

  // Identity first — everything else depends on knowing which avatar this
  // cabinet is showing.
  //
  // `?avatar=` overrides the cabinet's own id. It is how the Studio's "talk to
  // this avatar" link works: rather than embedding a half-alive copy of the
  // kiosk in a dashboard panel, it opens the real thing pointed at one avatar.
  const wanted = new URLSearchParams(window.location.search).get('avatar')?.trim() || ''

  try {
    const { avatar, tryon, season } = await step('identity', () =>
      wanted ? fetchAvatar(wanted) : fetchKiosk(KIOSK_ID),
    )
    // Before anything paints. What the showroom is wearing this month arrives
    // with its identity, so the panel never flashes the everyday look and then
    // repaints itself into Diwali a moment later.
    applySeason(season)
    setIdentity(avatar.id, avatar.name, avatar.greeting)
    // Who is speaking. Without this the synthesiser takes the first name on a
    // fixed list, which is how a male avatar ended up with a woman's voice.
    voice.setVoiceProfile({
      gender: avatar.gender,
      voice: avatar.voice,
      lang: avatar.language,
    })
    // Whether this cabinet may offer a camera at all. Arrives with identity so
    // there is no second round trip and no moment where the button flickers in.
    if (tryon) setTryOn(tryon)
    setAvatarMedia({
      id: avatar.id,
      poster: avatar.poster,
      clips: avatar.clips as Partial<Record<Pose, string>>,
    })
  } catch (error) {
    setIdentity('', '', 'Welcome.')
    // Three different failures that used to read as one. A mistyped ?avatar=
    // sends whoever clicked the link to check the name; an unreachable backend
    // sends them to check the network; and a platform with no avatars in it
    // sends them to the Studio to make one. Saying "offline" for the last of
    // those is how a fresh install looks broken instead of empty.
    // Two audiences, and only one of them is standing in a mall.
    //
    // Whoever is setting this up needs to know which of three things went
    // wrong; a shopper needs a sentence that does not mention avatars, URLs or
    // the network. The panel gets the second and the console gets the first,
    // the same split the conversation errors already use.
    const empty = (error as Error)?.message === 'EMPTY'
    console.error(
      'boot: ' +
        (wanted
          ? `no avatar with id "${wanted}"`
          : empty
            ? 'the platform has no avatars yet — create one at /studio'
            : 'could not reach the backend'),
      error,
    )
    bus.emit('SYSTEM_ERROR', { message: 'Just a moment — setting up.' })
  }

  // Each of these is real work. A kiosk that looks ready before it is ready
  // feels broken the very first time someone speaks to it.
  await step('clips', () => mp4Renderer.initialize())
  await step('voices', () => voice.initialize())
  await step('microphone', () => voice.requestMicrophone())

  bus.emit('SYSTEM_READY')

  if (!voice.supported()) {
    // "Voice needs Chrome" is an instruction a shopper cannot act on, in front
    // of a cabinet they do not own. The person who can act on it reads consoles.
    console.error('voice: this browser has no speechSynthesis or no getUserMedia')
    bus.emit('SYSTEM_ERROR', { message: 'Please use the buttons — I cannot hear right now.' })
  }

  watchForSleep()
}

/** The step name is for the console, never for the screen — boot shows motion,
 *  not a progress log. */
async function step<T>(name: string, work: () => Promise<T>): Promise<T> {
  bus.emit('SYSTEM_INITIALIZING', { step: name })
  return work()
}

// Read the id before the session module clears it — subscriber order on the bus
// is registration order, and this must not depend on it.
bus.on('SESSION_ENDED', () => {
  const ending = sessionId()
  void resetConversation(ending)
})

/**
 * Sleep is the one place pausing the footage is correct: the panel is black and
 * nobody is watching, so the decode cost of waking is invisible. It also spares
 * the OLED months of needless illumination.
 */
function watchForSleep() {
  let timer: number

  const arm = () => {
    window.clearTimeout(timer)
    if (useStore.getState().status !== 'idle') return
    timer = window.setTimeout(() => bus.emit('SESSION_SLEEP'), config.sleepAfter)
  }

  const activity = () => {
    // Waking on touch, not on speech — the microphone is released during sleep,
    // which is the entire point of sleeping.
    if (useStore.getState().status === 'sleeping') return bus.emit('SESSION_WAKE')
    arm()
  }

  document.addEventListener('pointerdown', activity)
  document.addEventListener('keydown', activity)
  useStore.subscribe(arm)
  arm()
}
