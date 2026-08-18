import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { bus } from '../bus/bus.ts'
import type { Product } from '../bus/events.ts'
import { useStore } from './store.ts'

const status = () => useStore.getState().status
const subtitle = () => useStore.getState().subtitle

const product = (id: string, name: string): Product => ({
  id, name,
  category: '', price: null, currency: 'INR', spoken_price: '',
  description: '', url: '', image: '', availability: 'in_stock', attributes: {},
})

/** Walk her to the point where a reply is being spoken. */
function untilSpeaking() {
  bus.emit('SYSTEM_READY')
  bus.emit('SESSION_STARTED')
  bus.emit('USER_UTTERANCE', { text: 'show me laptops' })
  bus.emit('REPLY_STARTED')
  bus.emit('SPEECH_STARTED')
  bus.emit('SPEECH_SENTENCE', { text: 'Of course.' })
}

beforeEach(() => {
  useStore.setState({ status: 'booting', subtitle: '', emotion: 'neutral' })
})

test('boot ends in idle, not in a conversation', () => {
  bus.emit('SYSTEM_INITIALIZING', { step: 'clips' })
  assert.equal(status(), 'initializing')
  bus.emit('SYSTEM_READY')
  assert.equal(status(), 'idle')
})

test('a boot error survives SYSTEM_READY', () => {
  // Regression: SYSTEM_READY set error:null, so the offline banner raised while
  // identity was failing was wiped a moment later and the kiosk looked healthy
  // while serving nothing.
  useStore.setState({ error: null })
  bus.emit('SYSTEM_ERROR', { message: 'The showroom is offline.' })
  bus.emit('SYSTEM_READY')
  assert.equal(status(), 'idle')
  assert.equal(useStore.getState().error, 'The showroom is offline.')
})

test('a session opens listening and stays hot after each reply', () => {
  untilSpeaking()
  assert.equal(status(), 'speaking')
  bus.emit('SPEECH_ENDED')
  // Back to listening, never to idle — the visitor should not press anything
  // to ask a second question.
  assert.equal(status(), 'listening')
})

test('the subtitle carries only the sentence being spoken right now', () => {
  untilSpeaking()
  assert.equal(subtitle(), 'Of course.')
  bus.emit('SPEECH_SENTENCE', { text: 'The Aria 14 is our lightest.' })
  assert.equal(subtitle(), 'The Aria 14 is our lightest.')
  bus.emit('SPEECH_ENDED')
  assert.equal(subtitle(), '')
})

test('barge-in returns her to listening and clears the caption', () => {
  untilSpeaking()
  bus.emit('USER_STARTED_SPEAKING')
  assert.equal(status(), 'listening')
  assert.equal(subtitle(), '')
})

test('a superseding question does not knock her out of thinking', () => {
  // Regression: run() used to announce REPLY_ABORTED while aborting the previous
  // request, which fired after USER_UTTERANCE had already put her in thinking —
  // so she dropped straight back out of it for the question she was answering.
  bus.emit('SYSTEM_READY')
  bus.emit('SESSION_STARTED')
  bus.emit('USER_UTTERANCE', { text: 'and the battery?' })
  assert.equal(status(), 'thinking')
})

test('an aborted reply never strands her mid-thought', () => {
  bus.emit('SYSTEM_READY')
  bus.emit('SESSION_STARTED')
  bus.emit('USER_UTTERANCE', { text: 'hello' })
  assert.equal(status(), 'thinking')
  bus.emit('REPLY_ABORTED')
  assert.equal(status(), 'listening')
})

test('REPLY_ABORTED while speaking does not interrupt her', () => {
  untilSpeaking()
  bus.emit('REPLY_ABORTED')
  assert.equal(status(), 'speaking')
})

test('ending a session returns to a clean idle', () => {
  untilSpeaking()
  bus.emit('SESSION_ENDED')
  assert.equal(status(), 'idle')
  assert.equal(subtitle(), '')
})

test('sleep and wake', () => {
  bus.emit('SYSTEM_READY')
  bus.emit('SESSION_SLEEP')
  assert.equal(status(), 'sleeping')
  bus.emit('SESSION_WAKE')
  assert.equal(status(), 'idle')
})

test('naming a product keeps it selected when its results arrive', () => {
  // Navigation selects on the utterance; the catalog answers the same utterance a
  // moment later. The second must not undo the first, or the detail view opens
  // and bounces straight back to the grid.
  const shirt = product('A001', 'Linen Shirt')
  const tee = product('A002', 'Charcoal Tee')

  bus.emit('PRODUCTS_SHOWN', { products: [shirt, tee] })
  bus.emit('PRODUCT_SELECTED', { product: shirt })
  bus.emit('PRODUCTS_SHOWN', { products: [shirt, tee] })

  assert.equal(useStore.getState().selected?.id, 'A001')
})

test('a selection that is no longer in the results is dropped', () => {
  const shirt = product('A001', 'Linen Shirt')
  const laptop = product('P002', 'Titan Pro 16')

  bus.emit('PRODUCTS_SHOWN', { products: [shirt] })
  bus.emit('PRODUCT_SELECTED', { product: shirt })
  bus.emit('PRODUCTS_SHOWN', { products: [laptop] })

  // One result still selects itself.
  assert.equal(useStore.getState().selected?.id, 'P002')
})
