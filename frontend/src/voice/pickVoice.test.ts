import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickVoice } from './pickVoice.ts'

const v = (name: string, lang = 'en-US') => ({ name, lang })

const WINDOWS = [
  v('Microsoft David - English (United States)'),
  v('Microsoft Zira - English (United States)'),
  v('Microsoft Guy Online (Natural) - English (United States)'),
  v('Microsoft Aria Online (Natural) - English (United States)'),
]

test('a male avatar gets a male voice', () => {
  // The bug: the old list was entirely female, so Krish spoke as a woman.
  const picked = pickVoice(WINDOWS, { gender: 'male' })
  assert.match(picked!.name, /Guy|David/)
})

test('a female avatar gets a female voice', () => {
  const picked = pickVoice(WINDOWS, { gender: 'female' })
  assert.match(picked!.name, /Aria|Zira/)
})

test('an exact voice name overrides the gender', () => {
  // Someone who typed a name meant it, even if we would not have chosen it.
  const picked = pickVoice(WINDOWS, {
    gender: 'male',
    voice: 'Microsoft Zira - English (United States)',
  })
  assert.equal(picked!.name, 'Microsoft Zira - English (United States)')
})

test('an unknown exact name does not silence him', () => {
  const picked = pickVoice(WINDOWS, { gender: 'male', voice: 'Nobody At All' })
  assert.match(picked!.name, /Guy|David/)
})

test('an unlisted platform still guesses from the name', () => {
  // Voice names are not standardised. "Microsoft Andrew" is not on our list,
  // but it is a better guess for a man than the first entry in the array.
  const exotic = [v('Microsoft Sonia - English (UK)'), v('Microsoft Andrew - English (US)')]
  assert.equal(pickVoice(exotic, { gender: 'male' })!.name, 'Microsoft Andrew - English (US)')
  assert.equal(pickVoice(exotic, { gender: 'female' })!.name, 'Microsoft Sonia - English (UK)')
})

test('no gender falls back to the language, then to anything', () => {
  const french = [v('Thomas', 'fr-FR')]
  assert.equal(pickVoice(french, {})!.name, 'Thomas')
  assert.equal(pickVoice(french, { lang: 'fr-FR' })!.name, 'Thomas')
})

test('no voices at all returns null rather than throwing', () => {
  assert.equal(pickVoice([], { gender: 'male' }), null)
})

test('a gender with no match still speaks', () => {
  // Silence is worse than the wrong accent.
  const only = [v('Google Nederlands', 'nl-NL')]
  assert.equal(pickVoice(only, { gender: 'male' })!.name, 'Google Nederlands')
})
