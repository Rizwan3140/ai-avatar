/**
 * Forwards raw microphone samples to the main thread.
 *
 * The AudioContext is created at 16 kHz mono, which is exactly what Whisper
 * wants, so the browser does the resampling and there is none to do here.
 *
 * Raw PCM rather than MediaRecorder on purpose: webm chunks after the first are
 * not independently decodable, so you cannot transcribe a partial utterance
 * without the container header. Plain samples can be sliced anywhere.
 */
class PcmWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel) this.port.postMessage(new Float32Array(channel))
    return true
  }
}

registerProcessor('pcm-worklet', PcmWorklet)
