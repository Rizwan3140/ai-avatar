import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve, context } from './navigation.ts'
import type { Product } from '../bus/events.ts'

const make = (id: string, name: string, price: number): Product => ({
  id, name, price,
  category: 'Laptops', currency: 'INR', spoken_price: `₹${price.toLocaleString('en-IN')}`,
  description: '', url: '', image: '', availability: 'in_stock', attributes: {},
})

const aria = make('L1', 'Aria 14 Laptop', 1299)
const titan = make('L2', 'Titan Pro 16', 1899)
const beam = make('M1', 'Beam Monitor 27', 329)
const shown = [aria, titan, beam]

const picked = (text: string, selected: Product | null = null) => {
  const nav = resolve(text, shown, selected)
  return nav.kind === 'select' ? nav.product.name : nav.kind
}

test('names a product directly', () => {
  assert.equal(picked('tell me about the Titan Pro 16'), 'Titan Pro 16')
  assert.equal(picked('how much is the beam monitor 27'), 'Beam Monitor 27')
})

test('ignores words that match everything', () => {
  // "Laptop" appears in two names, so it identifies nothing on its own.
  assert.equal(picked('show me a laptop'), 'none')
})

test('ordinals people actually say', () => {
  assert.equal(picked('tell me about the first one'), 'Aria 14 Laptop')
  assert.equal(picked('what about the second'), 'Titan Pro 16')
  assert.equal(picked('and the last one?'), 'Beam Monitor 27')
})

test('cheaper and more expensive', () => {
  assert.equal(picked('which is cheaper'), 'Beam Monitor 27')
  assert.equal(picked('show me the premium one'), 'Titan Pro 16')
})

test('next wraps rather than stopping', () => {
  assert.equal(picked('show me another', aria), 'Titan Pro 16')
  // At the end of a short list, "another" should keep going round.
  assert.equal(picked('next one', beam), 'Aria 14 Laptop')
})

test('previous walks back', () => {
  assert.equal(picked('go back', titan), 'Aria 14 Laptop')
})

test('pronouns resolve to what is being discussed', () => {
  assert.equal(picked('is that good for gaming', titan), 'Titan Pro 16')
  // With nothing chosen yet, "that" means the first thing on screen.
  assert.equal(picked('tell me more about this'), 'Aria 14 Laptop')
})

test('dismissing clears the screen', () => {
  assert.equal(picked('never mind'), 'clear')
  assert.equal(picked('hide those'), 'clear')
})

test('an ordinary question navigates nowhere', () => {
  assert.equal(picked('do you have anything in blue'), 'none')
  assert.equal(picked('what are your opening hours'), 'none')
})

test('nothing on screen means nothing to resolve', () => {
  assert.equal(resolve('the cheaper one', [], null).kind, 'none')
})

test('context tells the model what is on screen', () => {
  const text = context(shown, titan)
  assert.ok(text.includes('Aria 14 Laptop'))
  assert.ok(text.includes('Titan Pro 16'))
  assert.ok(text.includes('"this", "that" and "it" mean that one'))
})

test('context is empty when he has the screen to himself', () => {
  assert.equal(context([], null), '')
})

// A false positive here opens a camera on a member of the public who did not ask
// for one, so these lean hard on the negative cases.
const tried = (text: string, selected: Product | null = null, list = shown) => {
  const nav = resolve(text, list, selected)
  return nav.kind === 'tryon' ? nav.product.name : nav.kind
}

test('asking to try something on is recognised', () => {
  assert.equal(tried('can I try that on', titan), 'Titan Pro 16')
  assert.equal(tried('try it on me', aria), 'Aria 14 Laptop')
  assert.equal(tried('how would that look on me', beam), 'Beam Monitor 27')
  assert.equal(tried('can I see it on myself', aria), 'Aria 14 Laptop')
})

test('naming the product while asking to wear it keeps both halves', () => {
  // Resolving this as a plain selection loses the request, and the visitor has
  // to say it again to a screen that apparently ignored them.
  assert.equal(tried('can I try the Titan Pro 16 on'), 'Titan Pro 16')
})

test('a single result needs no pronoun', () => {
  assert.equal(tried('can I try it on', null, [aria]), 'Aria 14 Laptop')
})

test('several on screen and no referent asks rather than guessing', () => {
  // Photographing someone in the wrong garment is worse than not starting.
  assert.equal(tried('can I try one on'), 'none')
})

test('"try" alone is navigation, not a camera', () => {
  // "other one" is NEXT, and "one" does not match the \bon\b the try-on rule
  // needs — so this stays a plain move through the list.
  assert.equal(tried('try the other one', titan), 'select')
  assert.equal(picked('try the other one', titan), 'Beam Monitor 27')
  assert.equal(tried('I will try to come back tomorrow', titan), 'none')
  // Both still resolve the pronoun — they are questions *about* the product.
  // What matters is that neither reaches for a camera.
  assert.equal(tried('what is the return policy on that', titan), 'select')
  assert.equal(tried('is there a discount on it', titan), 'select')
})
