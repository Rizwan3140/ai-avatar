import { bus } from '../bus/bus.ts'
import { splitSentences } from '../logic.ts'
import { pickVoice } from './pickVoice.ts'
import config from './voice.config.ts'

let voice: SpeechSynthesisVoice | null = null
/** Who is speaking — set from the avatar this cabinet is showing. */
let profile: { gender?: string; voice?: string; lang?: string } = {}

/**
 * Tell the synthesiser who it is speaking as.
 *
 * Called at boot once the kiosk knows its avatar. Re-picks immediately, so a
 * cabinet re-pointed at a different avatar does not keep the previous voice.
 */
export function setVoiceProfile(next: typeof profile): void {
  profile = next
  const voices = speechSynthesis.getVoices()
  if (voices.length) voice = pickVoice(voices, profile)
}
let queue: string[] = []
let buffer = ''
let streamOpen = false
let speaking = false
/** SPEECH_STARTED already announced for the reply in progress. */
let announced = false
/** What is leaving the speaker right now — the echo filter compares against this. */
let spokenNow = ''

/**
 * Resolve voices before she is ever asked to talk. getVoices() is async in
 * Chrome and returns [] on first call; skipping this wait is why browser TTS so
 * often speaks its first sentence in the wrong voice.
 */
export function loadVoices(): Promise<void> {
  return new Promise((resolve) => {
    const pick = () => {
      const voices = speechSynthesis.getVoices()
      if (!voices.length) return false
      voice = pickVoice(voices, profile)
      return true
    }

    if (pick()) return resolve()
    speechSynthesis.addEventListener('voiceschanged', () => { pick(); resolve() }, { once: true })
    // Some platforms never fire the event. Never block boot on a voice.
    setTimeout(resolve, 2000)
  })
}

/** A reply is beginning. */
export function openStream(): void {
  cancel(false)
  buffer = ''
  streamOpen = true
}

/**
 * Feed streaming tokens. Complete sentences are spoken as soon as they exist
 * rather than when the reply finishes — this is what puts first audio under a
 * second instead of waiting out the whole generation.
 */
export function feed(chunk: string): void {
  if (!streamOpen) return
  buffer += chunk
  const { sentences, remainder } = splitSentences(buffer)
  buffer = remainder
  if (sentences.length) {
    queue.push(...sentences)
    pump()
  }
}

/** The reply is complete; speak whatever did not end in a terminator. */
export function closeStream(): void {
  if (!streamOpen) return
  streamOpen = false
  const tail = buffer.trim()
  buffer = ''
  if (tail) queue.push(tail)
  pump()
  if (!speaking && !queue.length) {
    announced = false
    bus.emit('SPEECH_ENDED')
  }
}

/**
 * Stop, but let the sentence in flight land.
 *
 * `cancel()` cuts the synthesiser off mid-word, which is what barge-in used to
 * do. In a real room that is worse than the problem it solves: any cough, any
 * "mm-hm", any bit of his own voice returning through the microphone chopped him
 * off in the middle of a word, and a half-said sentence reads as a crash rather
 * than as attentiveness.
 *
 * So the queue is dropped and the stream closed — he will not start another
 * sentence — but the one already leaving the speaker finishes. `next()` then
 * finds an empty queue on a closed stream and emits SPEECH_ENDED on its own.
 *
 * This is the one place the design deliberately reversed after being used: the
 * original note said talking over the visitor was the most human-breaking
 * failure. Being cut off mid-word turned out to be worse.
 */
export function finishThenStop(): void {
  queue = []
  buffer = ''
  streamOpen = false

  // Nothing in flight to wait for — this is an ordinary stop.
  if (!speaking) {
    announced = false
    spokenNow = ''
    bus.emit('SPEECH_CANCELLED')
  }
}

/** Hard stop, mid-word. The end of a session, or a reply that failed. */
export function cancel(announce = true): void {
  const wasActive = speaking || queue.length > 0
  queue = []
  buffer = ''
  streamOpen = false
  speaking = false
  announced = false
  spokenNow = ''
  speechSynthesis.cancel()
  if (announce && wasActive) bus.emit('SPEECH_CANCELLED')
}

export function currentlySpoken(): string {
  return spokenNow
}

export function isSpeaking(): boolean {
  return speaking
}

function pump(): void {
  if (speaking) return
  const text = queue.shift()
  if (!text) return

  const utterance = new SpeechSynthesisUtterance(text)
  if (voice) utterance.voice = voice
  utterance.lang = config.lang
  utterance.rate = config.rate
  utterance.pitch = config.pitch
  utterance.volume = config.volume

  utterance.onstart = () => {
    spokenNow = text
    bus.emit('SPEECH_SENTENCE', { text })
  }
  utterance.onend = next
  utterance.onerror = next

  // Once per reply, not once per sentence. `next()` clears `speaking` between
  // sentences, so a plain `!speaking` check here was true again for every
  // sentence in the same reply.
  if (!announced) {
    announced = true
    bus.emit('SPEECH_STARTED')
  }
  speaking = true
  speechSynthesis.speak(utterance)

  function next() {
    speaking = false
    spokenNow = ''
    if (queue.length) return pump()
    // Silence between chunks is not the end of a reply — only a drained queue
    // on a closed stream is, or she stops mid-thought.
    if (!streamOpen) {
      announced = false
      bus.emit('SPEECH_ENDED')
    }
  }
}
