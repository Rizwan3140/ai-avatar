import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitSentences, isEcho } from './logic.ts'

test('splits a complete multi-sentence chunk', () => {
  const { sentences, remainder } = splitSentences('Hello there. How can I help? ')
  assert.deepEqual(sentences, ['Hello there.', 'How can I help?'])
  assert.equal(remainder.trim(), '')
})

test('holds back a sentence that is still growing', () => {
  const { sentences, remainder } = splitSentences('Of course. The Aria 14 is')
  assert.deepEqual(sentences, ['Of course.'])
  assert.equal(remainder.trim(), 'The Aria 14 is')
})

test('holds a terminator sitting at the buffer edge', () => {
  // "$14." must not be spoken before we know it is not "$14.99".
  const { sentences, remainder } = splitSentences('It costs $14.')
  assert.deepEqual(sentences, [])
  assert.equal(remainder, 'It costs $14.')
})

test('does not cut inside a decimal', () => {
  const { sentences } = splitSentences('It weighs 2.4 kilograms and folds flat. ')
  assert.deepEqual(sentences, ['It weighs 2.4 kilograms and folds flat.'])
})

test('does not cut on abbreviations or initials', () => {
  const { sentences } = splitSentences('Dr. Chen designed it. J. Park tuned the display. ')
  assert.deepEqual(sentences, ['Dr. Chen designed it.', 'J. Park tuned the display.'])
})

test('collapses terminator runs into one cut', () => {
  const { sentences } = splitSentences('Absolutely!! Well... it depends. ')
  assert.deepEqual(sentences, ['Absolutely!!', 'Well...', 'it depends.'])
})

test('cuts on newlines and drops empty lines', () => {
  const { sentences, remainder } = splitSentences('First line\n\nSecond line\ntail')
  assert.deepEqual(sentences, ['First line', 'Second line'])
  assert.equal(remainder, 'tail')
})

test('empty input yields nothing', () => {
  assert.deepEqual(splitSentences(''), { sentences: [], remainder: '' })
})

test('isEcho rejects her own words coming back through the mic', () => {
  const spoken = 'Sure, here are some laptops I think you will love.'
  assert.equal(isEcho('here are some laptops', spoken), true)
  assert.equal(isEcho('SURE, HERE ARE SOME LAPTOPS!', spoken), true)
})

test('isEcho accepts a genuine interruption during speech', () => {
  const spoken = 'Sure, here are some laptops I think you will love.'
  assert.equal(isEcho('what about battery life', spoken), false)
})

test('isEcho treats silence as echo and speech-while-silent as genuine', () => {
  assert.equal(isEcho('   ', 'anything'), true)
  assert.equal(isEcho('show me laptops', ''), false)
})
