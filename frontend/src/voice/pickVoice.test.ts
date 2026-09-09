import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickVoice, voicesFor } from './pickVoice.ts'

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

test('an unknown exact name does not silence them', () => {
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

/**
 * The Studio's voice list, narrowed by the gender chosen beside it.
 *
 * It offered every installed voice whatever was selected, so "Female" plus a
 * voice called David was a reachable combination — and an exact name overrides
 * the gender outright, so the control that looked like a refinement silently
 * won.
 */
test('a gender narrows the list to voices that fit it', () => {
  const male = voicesFor(WINDOWS, 'male').map((v) => v.name)
  assert.ok(male.length > 0)
  assert.ok(!male.some((n) => /aria|jenny|zira/i.test(n)), `female voices survived: ${male}`)
})

test('and the other way round', () => {
  const female = voicesFor(WINDOWS, 'female').map((v) => v.name)
  assert.ok(female.length > 0)
  assert.ok(!female.some((n) => /david|guy|ryan/i.test(n)), `male voices survived: ${female}`)
})

test('"either" is a real answer and keeps everything', () => {
  assert.equal(voicesFor(WINDOWS, '').length, WINDOWS.length)
})

test('a machine whose voices cannot be classified still offers them', () => {
  // Never an empty list: a control with nothing in it reads as broken, and
  // every one of these is still a voice somebody may legitimately want.
  const odd = [{ name: 'Voix 3', lang: 'fr-FR' }, { name: 'Stimme 7', lang: 'de-DE' }]
  assert.equal(voicesFor(odd, 'male').length, 2)
})

test('what the list offers is what pickVoice would choose', () => {
  // One rule, not two. A separate opinion about what sounds male would drift
  // from this one, and the drift would be a cabinet speaking in a voice nobody
  // picked from a list that never offered it.
  for (const gender of ['male', 'female']) {
    const offered = voicesFor(WINDOWS, gender).map((v) => v.name)
    const chosen = pickVoice(WINDOWS, { gender })
    assert.ok(chosen && offered.includes(chosen.name), `${gender}: ${chosen?.name} not offered`)
  }
})
