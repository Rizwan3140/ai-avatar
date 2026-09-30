import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitSentences, isEcho, stripEcho } from './logic.ts'

test('splits a complete multi-sentence chunk', () => {
  const { sentences, remainder } = splitSentences('Hello there. How can I help? ')
  assert.deepEqual(sentences, ['Hello there.', 'How can I help?'])
  assert.equal(remainder.trim(), '')
})

test('a Hindi full stop ends a sentence', () => {
  const { sentences, remainder } = splitSentences('नमस्ते। आप कैसे हैं? ')
  assert.deepEqual(sentences, ['नमस्ते।', 'आप कैसे हैं?'])
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

test('isEcho rejects their own words coming back through the mic', () => {
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

test('isEcho catches a garbled echo, which is the only kind there is', () => {
  // Straight from the cabinet's log: they said one thing, the microphone heard it
  // back, and Whisper transcribed the last word wrong every time. An exact
  // substring match returns false for all of these, which is how one greeting
  // turned into forty-six turns of a cabinet answering itself.
  const spoken = ["I'll be here whenever you need me."]
  assert.equal(isEcho("I'll be there", spoken), true)
  assert.equal(isEcho("I'll be here", spoken), true)
  assert.equal(isEcho("I'll be good", spoken), true)
})

test('isEcho searches everything said recently, not just the sentence in flight', () => {
  // The echo of a sentence arrives after that sentence has finished — end-of-turn
  // silence plus transcription — so by the time we ask, `currentlySpoken()` has
  // already moved on or gone empty.
  const recent = ['How can I help you today?', 'Welcome to our showroom.']
  assert.equal(isEcho('welcome to our showroom', recent), true)
  assert.equal(isEcho('how can I help you today', recent), true)
  assert.equal(isEcho('do you have any sarees', recent), false)
})

test('isEcho does not steal a short phrase the visitor genuinely repeats', () => {
  // "The linen shirt" is a thing a person says immediately after they say it, so
  // a three-word transcript has to match them completely before it is discarded.
  const recent = ['The linen shirt is sixty dollars.']
  assert.equal(isEcho('the linen shirt', recent), true) // every word is their
  assert.equal(isEcho('linen shirt size', recent), false) // "size" is not
  assert.equal(isEcho('how much', recent), false)
})

test('isEcho hears Indian scripts instead of discarding them as silence', () => {
  // `[^a-z0-9]` used to strip a Telugu transcript to "", which reads as echo —
  // so every turn a Telugu avatar heard was thrown away before reaching the model.
  assert.equal(isEcho('నమస్కారం మీకు ఎలా సహాయం చేయగలను', ''), false)
  assert.equal(isEcho('नमस्ते, कुर्ता दिखाइए', ['Welcome to Dhiyona.']), false)
  // And a Telugu echo of their own Telugu sentence is still caught.
  const recent = ['స్వాగతం, దయచేసి మీరు చూసే వస్తువులను పరిశీలించండి.']
  assert.equal(isEcho('స్వాగతం దయచేసి మీరు చూసే వస్తువులను', recent), true)
})

test('stripEcho keeps the visitor\'s words when their last sentence is glued on', () => {
  // A real transcript: their refusal came back through the microphone joined to
  // the visitor's next request, and the whole thing was searched as one question.
  const recent = ["I'm afraid we don't carry Curtis."]
  assert.equal(
    stripEcho("I'm afraid we don't carry Curtis. Show me black T-shirt.", recent),
    'Show me black T-shirt.',
  )
  // Every sentence theirs: nothing is left to answer.
  assert.equal(stripEcho("I'm afraid we don't carry Curtis. I'm afraid we don't carry Curtis.", recent), '')
  // One sentence is left to isEcho, and a short one is never stripped.
  assert.equal(stripEcho('Show me kurtas.', recent), 'Show me kurtas.')
  assert.equal(stripEcho('Curtis. Show me kurtas.', recent), 'Curtis. Show me kurtas.')
  // Nothing recent, nothing removed.
  assert.equal(stripEcho('Hello there. Show me sarees.', []), 'Hello there. Show me sarees.')
})
