import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeWav, rms } from './wav.ts'

const read = (buffer: ArrayBuffer) => new DataView(buffer)
const ascii = (view: DataView, offset: number, length: number) =>
  String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)))

test('encodeWav writes a header the decoder will accept', () => {
  const view = read(encodeWav(new Float32Array(100), 16000))

  assert.equal(ascii(view, 0, 4), 'RIFF')
  assert.equal(ascii(view, 8, 4), 'WAVE')
  assert.equal(ascii(view, 36, 4), 'data')
  assert.equal(view.getUint16(20, true), 1, 'PCM')
  assert.equal(view.getUint16(22, true), 1, 'mono')
  assert.equal(view.getUint32(24, true), 16000, 'sample rate')
  assert.equal(view.getUint16(34, true), 16, 'bits per sample')
  // Sizes must agree with the payload or the file is truncated on read.
  assert.equal(view.getUint32(40, true), 200, 'data size = 100 samples * 2 bytes')
  assert.equal(view.getUint32(4, true), 236, 'riff size = 36 + data')
})

test('encodeWav converts float samples to 16-bit', () => {
  const view = read(encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000))
  assert.equal(view.getInt16(44, true), 0)
  assert.equal(view.getInt16(46, true), 32767)
  assert.equal(view.getInt16(48, true), -32767)
  assert.equal(view.getInt16(50, true), 16383)
})

test('encodeWav clamps rather than wrapping', () => {
  // Auto gain control can push samples past 1.0. Without the clamp these wrap
  // to the opposite rail and the audio arrives as full-scale noise.
  const view = read(encodeWav(new Float32Array([2, -2]), 16000))
  assert.equal(view.getInt16(44, true), 32767)
  assert.equal(view.getInt16(46, true), -32767)
})

test('rms measures loudness', () => {
  assert.equal(rms(new Float32Array(0)), 0)
  assert.equal(rms(new Float32Array([0, 0, 0])), 0)
  assert.equal(rms(new Float32Array([1, -1, 1, -1])), 1)
  // Below the default 0.02 voice floor — this is a quiet room, not speech.
  assert.ok(rms(new Float32Array([0.01, -0.01])) < 0.02)
})
