import { bus } from '../bus/bus.ts'
import config from './voice.config.ts'
import { encodeWav, rms } from './wav.ts'

type Handlers = {
  /** Best guess at the turn so far, while the visitor is still talking. */
  onInterim(text: string): void
  /** The finished turn. */
  onFinal(text: string): void
  /** Voice energy crossed the barge-in floor while she was talking. */
  onVoiceStart(): void
  onError(message: string): void
}

let context: AudioContext | null = null
let stream: MediaStream | null = null
let handlers: Handlers | null = null

/** Samples of the turn in progress. */
let turn: Float32Array[] = []
let turnSamples = 0
let speaking = false
let voiceStartedAt = 0
let lastVoiceAt = 0
let partialAt = 0
let peak = 0
let transcribing = false
let levelAt = 0
/** Barge-in already announced for the turn in progress. */
let barged = false

/** Longest audio worth re-transcribing for the live caption. */
const partialSampleCap = (config.sampleRate * config.maxPartialMs) / 1000

export function isSupported(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia) && 'AudioContext' in window
}

/**
 * The microphone stays hot for the whole conversation — a person does not press
 * a button before each sentence. Voice activity decides where turns begin and
 * end; nothing here depends on a cloud service, so it works offline and in any
 * browser.
 */
export async function startListening(h: Handlers): Promise<void> {
  handlers = h
  if (context) return

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    })
  } catch {
    return h.onError('Microphone access is blocked.')
  }

  try {
    // 16 kHz mono is what Whisper wants, so the browser resamples and we do not.
    context = new AudioContext({ sampleRate: config.sampleRate })
    await context.audioWorklet.addModule('/pcm-worklet.js')

    // An AudioContext created outside a click starts suspended, and a suspended
    // context never calls the worklet — the microphone looks open and delivers
    // nothing at all.
    if (context.state !== 'running') await context.resume()

    const source = context.createMediaStreamSource(stream)
    const worklet = new AudioWorkletNode(context, 'pcm-worklet')
    worklet.port.onmessage = (event) => onSamples(event.data as Float32Array)
    source.connect(worklet)
    // Chrome will not pull from a worklet that reaches no destination. Routing
    // it through a silent gain keeps samples flowing without any of it being
    // heard.
    const sink = context.createGain()
    sink.gain.value = 0
    worklet.connect(sink).connect(context.destination)

    bus.emit('RECOGNITION_STATE', { running: true })
    if (context.state !== 'running') {
      bus.emit('RECOGNITION_STATE', { running: false, error: `audio context ${context.state}` })
    }
  } catch (error) {
    // Without this the failure vanishes into an unawaited promise and the mic
    // simply appears to do nothing.
    await teardown()
    h.onError(`Could not start audio capture: ${(error as Error).message}`)
  }
}

export async function stopListening(): Promise<void> {
  await teardown()
  bus.emit('RECOGNITION_STATE', { running: false })
}

async function teardown() {
  reset()
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  await context?.close().catch(() => {})
  context = null
}

function reset() {
  turn = []
  turnSamples = 0
  speaking = false
  transcribing = false
  peak = 0
  barged = false
}

function onSamples(block: Float32Array) {
  const level = rms(block)
  const now = performance.now()

  // The render quantum is 128 samples, so this fires ~125 times a second.
  // Throttle it before it becomes 125 events and 125 style writes per second.
  if (now - levelAt > 50) {
    levelAt = now
    bus.emit('MIC_LEVEL', { level })
  }

  const loud = level >= config.voiceThreshold

  if (loud) {
    if (!speaking) {
      speaking = true
      voiceStartedAt = now
      partialAt = now
      peak = 0
      barged = false
    }
    lastVoiceAt = now
    peak = Math.max(peak, level)
    // Barge-in is decided on energy, not on words — waiting for a transcript
    // means talking over the visitor for a second, which is the most
    // human-breaking thing this system can do.
    //
    // Once per turn, on the edge. This ran on every 128-sample block above the
    // floor — ~125 USER_STARTED_SPEAKING events a second for as long as someone
    // talked over her, each one re-entering cancel and re-clearing the caption.
    if (!barged && level >= config.bargeInThreshold) {
      barged = true
      handlers?.onVoiceStart()
    }
  }

  if (!speaking) return

  turn.push(block)
  turnSamples += block.length

  const silenceMs = now - lastVoiceAt
  const voicedMs = lastVoiceAt - voiceStartedAt

  if (silenceMs >= config.endOfTurnSilence || now - voiceStartedAt >= config.maxUtteranceMs) {
    // A cough, a door, a chair is not a turn.
    if (voicedMs < config.minSpeechMs) {
      bus.emit('VOICE_ACTIVITY', { speaking: false, durationMs: voicedMs, peak })
      return reset()
    }
    bus.emit('VOICE_ACTIVITY', { speaking: false, durationMs: voicedMs, peak })
    return finishTurn()
  }

  // Partials are display-only, and each one re-encodes the whole turn so far —
  // cost grows with the square of turn length, and every pass now queues ahead
  // of the final one on the model lock. Past the cap the caption simply stops
  // updating; the final transcript is unaffected.
  if (now - partialAt >= config.partialInterval && turnSamples <= partialSampleCap) {
    partialAt = now
    void sendPartial()
  }
}

function finishTurn() {
  const audio = drain()
  reset()
  void transcribe(audio, false).then((text) => text && handlers?.onFinal(text))
}

/** Re-transcribe the turn so far so the transcript follows along. */
async function sendPartial() {
  if (transcribing) return // Never queue up behind a slow pass.
  transcribing = true
  const text = await transcribe(flatten(), true)
  transcribing = false
  if (text && speaking) handlers?.onInterim(text)
}

async function transcribe(audio: ArrayBuffer, partial: boolean): Promise<string> {
  try {
    const response = await fetch(`/api/listen${partial ? '?partial=1' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: audio,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as { text: string }
    return data.text
  } catch (error) {
    bus.emit('RECOGNITION_STATE', {
      running: true,
      error: `transcription failed: ${(error as Error).message}`,
    })
    return ''
  }
}

function flatten(): ArrayBuffer {
  const all = new Float32Array(turnSamples)
  let offset = 0
  for (const block of turn) {
    all.set(block, offset)
    offset += block.length
  }
  return encodeWav(all, config.sampleRate)
}

function drain(): ArrayBuffer {
  const audio = flatten()
  turn = []
  turnSamples = 0
  return audio
}
