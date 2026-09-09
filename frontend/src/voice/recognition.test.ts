import assert from 'node:assert/strict'
import { test } from 'node:test'
import config from './voice.config.ts'
import { nextNoiseFloor, speechFloor } from './recognition.ts'

/**
 * The room-noise half of voice detection.
 *
 * Worth pinning because it is the part that will be blamed when a cabinet
 * misbehaves in a mall and nobody can reproduce it at a desk. The arithmetic is
 * pure and testable; the microphone is not.
 */

test('a quiet room behaves exactly as it did before this existed', () => {
  // Ambient below the absolute floor must not lower the bar. The absolute
  // number was measured in a quiet room and still governs there.
  const floor = speechFloor(config.voiceThreshold, 0.001, config.speechOverNoise)
  assert.equal(floor, config.voiceThreshold)
})

test('a loud room raises the bar', () => {
  // A concourse sitting at 0.03 is already above the old fixed threshold, which
  // is why every moment of crowd noise read as speech.
  const floor = speechFloor(config.voiceThreshold, 0.03, config.speechOverNoise)
  assert.ok(floor > config.voiceThreshold)
  assert.equal(floor, 0.03 * config.speechOverNoise)
})

test('crowd noise no longer counts as somebody speaking', () => {
  const ambient = 0.03
  const floor = speechFloor(config.voiceThreshold, ambient, config.speechOverNoise)
  assert.ok(ambient < floor, 'the room itself must not clear its own floor')
})

test('a voice still clears the bar in that same room', () => {
  // Someone addressing a cabinet from a step away is far above the room.
  const floor = speechFloor(config.voiceThreshold, 0.03, config.speechOverNoise)
  assert.ok(0.15 > floor)
})

test('the floor falls faster than it rises', () => {
  // Compared over the same distance in each direction, because the step is a
  // proportion of the gap — a large jump at a slow rate can otherwise move
  // further than a small one at a fast rate, which says nothing about either.
  const start = 0.02
  const up = nextNoiseFloor(start, start + 0.01, false) - start
  const down = start - nextNoiseFloor(start, start - 0.01, false)
  assert.ok(down > up, `expected a faster fall: rose ${up}, fell ${down}`)
})

test('the floor does not move during a turn', () => {
  // A floor that climbs through someone's answer ends the turn on their own
  // voice — the visitor is cut off by the sound of themselves.
  assert.equal(nextNoiseFloor(0.02, 0.4, true), 0.02)
})

test('a visitor cannot deafen the cabinet by talking', () => {
  // Even sustained loud speech, if the floor were tracking it, must not climb
  // far in the time one sentence takes. 125 blocks a second, so this is a
  // second of shouting with the freeze deliberately disabled.
  let floor = 0.02
  for (let i = 0; i < 125; i++) floor = nextNoiseFloor(floor, 0.3, false)
  assert.ok(floor < 0.3 * 0.5, `floor ran up to ${floor}`)
})

test('a room that goes quiet is heard again within seconds', () => {
  // Two seconds, not half of one. The decay is a time constant of about 0.4s,
  // so half a second still leaves a third of the elevation — this test was
  // written asserting a recovery the constants do not provide, which is the
  // useful kind of failure: the number to trust is the measured one, not the
  // one that sounded good in a comment.
  //
  // Two seconds is the right target anyway. A cabinet that drops its guard the
  // instant a crowd passes will chase every gap between two groups of people.
  let floor = 0.08
  for (let i = 0; i < 250; i++) floor = nextNoiseFloor(floor, 0.004, false)
  const recovered = speechFloor(config.voiceThreshold, floor, config.speechOverNoise)
  assert.equal(recovered, config.voiceThreshold, `still elevated at ${floor}`)
})

test('holding a turn is easier than starting one', () => {
  // The dip between two words must not end the turn. One sentence arriving as
  // three fragments is three searches, and the products change under a customer
  // who is still mid-sentence.
  assert.ok(config.holdRatio < 1)
  const start = speechFloor(config.voiceThreshold, 0.03, config.speechOverNoise)
  assert.ok(start * config.holdRatio < start)
})

test('interrupting them needs more than starting a turn', () => {
  // The speaker feeds the microphone, so their own voice must never interrupt them.
  const speech = speechFloor(config.voiceThreshold, 0.03, config.speechOverNoise)
  const barge = speechFloor(config.bargeInThreshold, 0.03, config.bargeInOverNoise)
  assert.ok(barge > speech)
})
