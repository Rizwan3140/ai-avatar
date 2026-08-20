import { bus } from '../bus/bus.ts'
import { isEcho } from '../logic.ts'
import * as recognition from './recognition.ts'
import * as tts from './tts.ts'

/**
 * The Voice Engine.
 *
 * It owns the microphone, speech recognition, speech synthesis and interruption
 * handling — all of it. The Conversation Engine says "here are some words" and
 * never learns how they are heard or spoken, which is why replacing the local
 * Whisper path or the browser's synthesiser touches only this folder.
 */

let active = false

export function initialize(): Promise<void> {
  return tts.loadVoices()
}

/** Prompt for the microphone during boot, not mid-conversation. */
export async function requestMicrophone(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return false
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    // Capture opens its own stream; this was only ever about the prompt.
    stream.getTracks().forEach((t) => t.stop())
    return true
  } catch {
    return false
  }
}

export function supported(): boolean {
  return recognition.isSupported() && 'speechSynthesis' in window
}

bus.on('SESSION_STARTED', () => {
  active = true
  void recognition.startListening({ onInterim, onFinal, onVoiceStart, onError })
})

bus.on('SESSION_ENDED', stopEverything)
bus.on('SESSION_SLEEP', stopEverything)

bus.on('REPLY_STARTED', () => tts.openStream())
bus.on('REPLY_CHUNK', ({ text }) => tts.feed(text))
bus.on('REPLY_COMPLETE', () => tts.closeStream())
bus.on('REPLY_ABORTED', () => tts.cancel())

function stopEverything() {
  active = false
  void recognition.stopListening()
  tts.cancel(false)
}

/**
 * Voice activity detection decides where a turn ends, so a transcript arriving
 * here is already a whole thought. There is nothing left to buffer.
 */
function onFinal(text: string) {
  if (!active) return
  // Her own voice coming back through the microphone is not a question.
  if (tts.isSpeaking() && isEcho(text, tts.currentlySpoken())) {
    return bus.emit('USER_DISCARDED', { text, reason: 'echo' })
  }
  // Let the sentence he is on finish rather than clipping it. The reply itself
  // is already being abandoned upstream — this is only about the audio.
  tts.finishThenStop()
  bus.emit('USER_UTTERANCE', { text })
}

function onInterim(text: string) {
  if (!active) return
  if (tts.isSpeaking() && isEcho(text, tts.currentlySpoken())) return
  bus.emit('USER_INTERIM', { text })
}

/**
 * Energy crossed the barge-in floor. Acting on loudness rather than on words is
 * what makes an interruption feel instant — a transcript is a second too late.
 *
 * It stops him queueing anything further, but does not cut the current sentence.
 * Loudness is a crude signal: a cough, a passer-by, or his own voice coming back
 * through the microphone all cross the same floor, and none of them are worth
 * chopping a word in half for.
 */
function onVoiceStart() {
  if (!active || !tts.isSpeaking()) return
  bus.emit('USER_STARTED_SPEAKING')
  tts.finishThenStop()
}

function onError(message: string) {
  bus.emit('SYSTEM_ERROR', { message })
}
