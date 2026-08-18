import { bus } from '../bus/bus.ts'
import { mp4Renderer } from '../renderer/Mp4VideoRenderer.tsx'
import config, { KIOSK_ID } from '../renderer/renderer.config.ts'
import { setAvatarMedia } from '../renderer/renderer.avatar.ts'
import type { Pose } from '../renderer/renderer.types.ts'
import { fetchKiosk, resetConversation } from '../provider/http.ts'
import { setIdentity, setTryOn, useStore } from '../state/store.ts'
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
  try {
    const { avatar, tryon } = await step('identity', () => fetchKiosk(KIOSK_ID))
    setIdentity(avatar.id, avatar.name, avatar.greeting)
    // Whether this cabinet may offer a camera at all. Arrives with identity so
    // there is no second round trip and no moment where the button flickers in.
    if (tryon) setTryOn(tryon)
    setAvatarMedia({
      id: avatar.id,
      poster: avatar.poster,
      clips: avatar.clips as Partial<Record<Pose, string>>,
    })
  } catch {
    setIdentity('', '', 'Welcome.')
    bus.emit('SYSTEM_ERROR', { message: 'The showroom is offline.' })
  }

  // Each of these is real work. A kiosk that looks ready before it is ready
  // feels broken the very first time someone speaks to it.
  await step('clips', () => mp4Renderer.initialize())
  await step('voices', () => voice.initialize())
  await step('microphone', () => voice.requestMicrophone())

  bus.emit('SYSTEM_READY')

  if (!voice.supported()) {
    bus.emit('SYSTEM_ERROR', { message: 'Voice needs Chrome to work here.' })
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
