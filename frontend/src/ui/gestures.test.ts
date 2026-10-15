import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HOLD, type Hand, gesturesOn, poseOf, reader } from './gestures.ts'

const at = (x: number, pose: Hand['pose'], y = 0.5): Hand => ({ x, y, wx: x, wy: y, pose })

/** Frames every 66 ms, as the camera delivers them; what fired, in order. */
function play(frames: [Hand | null, unknown?][], start = 0) {
  const step = reader()
  return frames.map(([hand, target], i) => step(start + i * 66, hand, target ?? null).fire?.kind ?? '')
}

test('pointing at one thing for a second taps it, once', () => {
  const button = {}
  const fired = play(Array.from({ length: 30 }, () => [at(0.5, 'point'), button]))
  assert.deepEqual(fired.filter(Boolean), ['tap'])
  assert.ok(fired.indexOf('tap') * 66 >= HOLD.tap)
})

test('moving onto something else starts the hold again', () => {
  const a = {}
  const b = {}
  const frames: [Hand, unknown][] = Array.from({ length: 12 }, (_, i) => [at(0.5, 'point'), i % 2 ? a : b])
  assert.deepEqual(play(frames).filter(Boolean), [])
})

test('pointing at nothing taps nothing', () => {
  assert.deepEqual(play(Array.from({ length: 30 }, () => [at(0.5, 'point')])).filter(Boolean), [])
})

test('a hand swept right to left is next, and the hand coming back is not previous', () => {
  const across = (from: number, to: number) => Array.from({ length: 5 }, (_, i): [Hand] => [at(from + ((to - from) * i) / 4, 'other')])
  const fired = play([...across(0.8, 0.3), ...across(0.3, 0.8)])
  assert.deepEqual(fired.filter(Boolean), ['swipe'])
  const step = reader()
  let dir = 0
  for (const [i, [hand]] of across(0.8, 0.3).entries()) dir ||= (step(i * 66, hand) as { fire?: { dir: number } }).fire?.dir ?? 0
  assert.equal(dir, 1)
})

test('a slow drift is not a sweep, and moving the cursor fast is not one either', () => {
  const drift = Array.from({ length: 30 }, (_, i): [Hand] => [at(0.8 - i * 0.02, 'other')])
  assert.deepEqual(play(drift).filter(Boolean), [])
  const flick = Array.from({ length: 5 }, (_, i): [Hand] => [at(0.8 - i * 0.15, 'point')])
  assert.deepEqual(play(flick).filter(Boolean), [])
})

test('a palm held still is Back once; a palm waving is not', () => {
  assert.deepEqual(play(Array.from({ length: 40 }, () => [at(0.5, 'palm')])).filter(Boolean), ['back'])
  const waving = Array.from({ length: 40 }, (_, i): [Hand] => [at(0.5 + (i % 2 ? 0.08 : -0.08), 'palm')])
  assert.deepEqual(play(waving).filter(Boolean), [])
})

test('a thumb up held is talk; a blink of the detector does not reset it', () => {
  const frames: [Hand | null][] = Array.from({ length: 20 }, (_, i) => [i === 6 ? null : at(0.5, 'thumb')])
  assert.deepEqual(play(frames).filter(Boolean), ['talk'])
})

test('pointing is read from the fingers when MediaPipe has no name for it', () => {
  // Wrist at the bottom, index straight up, the others folded back.
  const p = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8 }))
  p[6] = { x: 0.5, y: 0.6 }
  p[8] = { x: 0.5, y: 0.4 }
  for (const [knuckle, tip] of [[10, 12], [14, 16]]) {
    p[knuckle] = { x: 0.52, y: 0.62 }
    p[tip] = { x: 0.52, y: 0.7 }
  }
  assert.equal(poseOf('None', p), 'point')
  assert.equal(poseOf('Open_Palm', p), 'palm')
  assert.equal(poseOf('None', []), 'other')
})

test('?gestures=0 switches this browser off, and it stays off', () => {
  const kept = new Map<string, string>()
  const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) }
  assert.equal(gesturesOn({ search: '', storage }), true)
  assert.equal(gesturesOn({ search: '?gestures=0', storage }), false)
  assert.equal(gesturesOn({ search: '', storage }), false)
  assert.equal(gesturesOn({ search: '?gestures=1', storage }), true)
})
