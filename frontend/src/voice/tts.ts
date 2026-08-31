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
/**
 * Everything he has said in the last few seconds, newest first.
 *
 * The echo filter used to compare against the sentence in flight alone, which
 * is empty the moment that sentence ends — and an echo comes back more than a
 * second later, after end-of-turn silence and transcription. So the one thing
 * the filter needed was the one thing it no longer had.
 */
let recent: { text: string; at: number }[] = []
/** The generated sentence currently playing, so `cancel()` can stop it the
 *  same way it stops the browser's synthesiser. */
let current: HTMLAudioElement | null = null
/** How far back an echo can plausibly arrive. Whisper is slower under load, and
 *  a stale entry only costs a rare ignored utterance. */
const ECHO_MEMORY_MS = 20000
/**
 * Bumped by `cancel()`. A cancelled utterance still fires its `onend`, and
 * that callback used to announce SPEECH_ENDED — so ending a conversation set
 * the renderer to idle and then immediately back to listening, and he stood
 * there leaning attentively at an empty room. Callbacks from a superseded
 * utterance check this and stay quiet.
 */
let epoch = 0

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
    bus.emit('SPEECH_CANCELLED')
  }
}

/** Hard stop, mid-word. The end of a session, or a reply that failed. */
export function cancel(announce = true): void {
  epoch += 1
  const wasActive = speaking || queue.length > 0
  queue = []
  buffer = ''
  streamOpen = false
  speaking = false
  announced = false
  speechSynthesis.cancel()
  // And the generated sentence, if that is what is playing. Stopping only the
  // browser's synthesiser would leave a cloned voice finishing a sentence into
  // a conversation that has already ended.
  if (current) {
    current.pause()
    URL.revokeObjectURL(current.src)
    current = null
  }
  if (announce && wasActive) bus.emit('SPEECH_CANCELLED')
}

/**
 * What to test an incoming transcript against: the sentence in flight, plus
 * everything said in the last few seconds. Prunes on read, so nothing has to run
 * a timer to keep it tidy.
 */
export function recentlySpoken(): string[] {
  const cutoff = Date.now() - ECHO_MEMORY_MS
  recent = recent.filter((r) => r.at >= cutoff)
  return recent.map((r) => r.text)
}

export function isSpeaking(): boolean {
  return speaking
}

/**
 * Whose voice this cabinet speaks in.
 *
 * Asked once at boot. With a recording uploaded for this avatar the sentences
 * are generated on the machine in that person's voice; without one the browser's
 * own synthesiser speaks, which is what every install did until now. The answer
 * decides for the whole session — switching mid-conversation would be two people
 * finishing each other's sentences.
 */
let cloned = false
let clonedFor = ''

export async function loadVoiceProfile(avatarId: string): Promise<void> {
  clonedFor = avatarId
  try {
    const r = await fetch(`/api/voice?avatar=${encodeURIComponent(avatarId)}`)
    cloned = r.ok ? Boolean((await r.json())?.available) : false
  } catch {
    // The browser's voice is the floor, and a failed check is not a reason to
    // lose it.
    cloned = false
  }
}

/** Audio for one sentence, or null to let the browser say it.
 *
 *  Never throws. Every failure here — model missing, generation slow, request
 *  refused — falls back to a synthesiser that is already loaded, because the one
 *  outcome worth avoiding is a cabinet that says nothing at all. */
async function generate(text: string): Promise<HTMLAudioElement | null> {
  try {
    const r = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, avatar_id: clonedFor }),
    })
    if (!r.ok) {
      // 503 means no voice is configured after all. Stop asking for the rest of
      // the session rather than paying a failed round trip per sentence.
      if (r.status === 503) cloned = false
      return null
    }
    const audio = new Audio(URL.createObjectURL(await r.blob()))
    audio.volume = config.volume
    return audio
  } catch {
    return null
  }
}

function pump(): void {
  if (speaking) return
  const mine = epoch
  const text = queue.shift()
  if (!text) return

  if (cloned) {
    speaking = true
    void generate(text).then((audio) => {
      // Cancelled while the audio was being generated. Saying it now would be a
      // sentence from a conversation that has already ended.
      if (mine !== epoch) {
        speaking = false
        return
      }
      if (!audio) {
        // Fell back mid-reply. Put the sentence back and let the browser say it.
        speaking = false
        queue.unshift(text)
        return pump()
      }
      recent.unshift({ text, at: Date.now() })
      bus.emit('SPEECH_SENTENCE', { text })
      if (!announced) {
        announced = true
        bus.emit('SPEECH_STARTED')
      }
      const playing = audio
      current = playing
      const finished = () => {
        if (mine !== epoch) return
        // One object URL per sentence, and a cabinet runs for months.
        URL.revokeObjectURL(playing.src)
        current = null
        speaking = false
        if (queue.length) return pump()
        if (!streamOpen) {
          announced = false
          bus.emit('SPEECH_ENDED')
        }
      }
      playing.onended = finished
      playing.onerror = finished
      void playing.play().catch(finished)
    })
    return
  }

  const utterance = new SpeechSynthesisUtterance(text)
  if (voice) utterance.voice = voice
  utterance.lang = config.lang
  utterance.rate = config.rate
  utterance.pitch = config.pitch
  utterance.volume = config.volume

  utterance.onstart = () => {
    // Recorded on start rather than on end: an echo of the first half of a
    // sentence can be transcribed before he has finished saying the second.
    recent.unshift({ text, at: Date.now() })
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
    // Superseded by a cancel: this utterance's completion is not news.
    if (mine !== epoch) return
    speaking = false
    if (queue.length) return pump()
    // Silence between chunks is not the end of a reply — only a drained queue
    // on a closed stream is, or she stops mid-thought.
    if (!streamOpen) {
      announced = false
      bus.emit('SPEECH_ENDED')
    }
  }
}
