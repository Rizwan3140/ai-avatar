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

/** Who this cabinet's avatar sounds like. Set once identity is known. */
export const setVoiceProfile = tts.setVoiceProfile

/** Whether this avatar speaks in a voice of its own, or the browser's. */
export const loadVoiceProfile = tts.loadVoiceProfile

export function initialize(): Promise<void> {
  // Both are boot-time questions with no answer worth blocking on: which voices
  // this browser has, and whether transcription is close enough to keep sending
  // partials to. Neither can fail in a way that should stop a cabinet starting.
  return Promise.all([tts.loadVoices(), recognition.loadCapabilities()]).then(() => {})
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

/**
 * Mute releases the microphone rather than ignoring what it hears.
 *
 * `stopListening` stops the media tracks and closes the AudioContext, so the
 * browser's own recording indicator goes out and the operating system stops
 * reporting this tab as listening. A visitor can therefore *check* that the
 * cabinet is not hearing them, instead of taking a caption's word for it —
 * which is the only version of this control worth shipping in a room full of
 * strangers.
 *
 * `active` goes down with it, so a transcript already in flight when the button
 * was pressed is discarded rather than answered.
 */
bus.on('MIC_MUTED', ({ muted }) => {
  if (muted) {
    active = false
    void recognition.stopListening()
    tts.cancel(false)
    return
  }
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
  // His own voice coming back through the microphone is not a question.
  //
  // No `isSpeaking()` guard. That guard is why a cabinet spent four minutes
  // answering itself every five seconds: a turn ends on 700ms of silence and
  // then waits on transcription, so the echo of a sentence arrives well after
  // that sentence finished — `isSpeaking()` was false, and the filter it guarded
  // was never called once. The check now stands on its own, against everything
  // he has said recently rather than against the sentence in flight.
  if (isEcho(text, tts.recentlySpoken())) {
    return bus.emit('USER_DISCARDED', { text, reason: 'echo' })
  }
  // Let the sentence he is on finish rather than clipping it. The reply itself
  // is already being abandoned upstream — this is only about the audio.
  tts.finishThenStop()
  bus.emit('USER_UTTERANCE', { text })
}

function onInterim(text: string) {
  if (!active) return
  if (isEcho(text, tts.recentlySpoken())) return
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
