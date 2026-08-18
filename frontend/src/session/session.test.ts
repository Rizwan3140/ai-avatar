import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bus } from '../bus/bus.ts'
import { sessionId } from './session.ts'

/**
 * Session identity is what keeps two cabinets on one backend from sharing a
 * conversation. When it silently falls back to a constant, the failure is
 * invisible until two strangers are answering each other's questions.
 */

test('no session until someone starts talking', () => {
  assert.equal(sessionId(), 'default')
})

test('a session begins when a visitor does', () => {
  bus.emit('SESSION_STARTED')
  const first = sessionId()
  assert.notEqual(first, 'default')
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('each visitor gets a different one', () => {
  bus.emit('SESSION_STARTED')
  const a = sessionId()
  bus.emit('SESSION_STARTED')
  assert.notEqual(sessionId(), a)
})

test('ending releases it', () => {
  bus.emit('SESSION_STARTED')
  bus.emit('SESSION_ENDED')
  assert.equal(sessionId(), 'default')
})

test('sleeping releases it — whoever wakes the screen is someone new', () => {
  bus.emit('SESSION_STARTED')
  bus.emit('SESSION_SLEEP')
  assert.equal(sessionId(), 'default')
})

test('works without crypto.randomUUID, as on a plain-http kiosk', () => {
  // Secure-context-only API. Removing it must not send every cabinet back to
  // sharing the "default" session.
  const original = crypto.randomUUID
  try {
    // @ts-expect-error — deliberately simulating an insecure context
    delete crypto.randomUUID
    bus.emit('SESSION_STARTED')
    const id = sessionId()
    assert.notEqual(id, 'default')
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  } finally {
    crypto.randomUUID = original
  }
})
