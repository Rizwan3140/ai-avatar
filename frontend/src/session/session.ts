import { bus } from '../bus/bus.ts'

/**
 * One visitor's conversation.
 *
 * A new id every time someone starts talking, so a backend serving several
 * cabinets keeps their histories apart — and so the person who walks up next
 * does not inherit the last visitor's conversation, which on a public screen is
 * both confusing and a small privacy problem.
 *
 * Not persisted anywhere. When the session ends the id is gone.
 */
let current = ''

/**
 * `crypto.randomUUID` exists only in a secure context, and a cabinet served over
 * plain http on a LAN is not one. Without the fallback the id stays empty, every
 * kiosk quietly shares the "default" session again, and the failure is invisible
 * — the conversations just start bleeding into each other.
 *
 * `getRandomValues` is available everywhere, so only the formatting is ours.
 */
function newId(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function sessionId(): string {
  return current || 'default'
}

bus.on('SESSION_STARTED', () => {
  current = newId()
})

bus.on('SESSION_ENDED', () => {
  current = ''
})

// Sleep means the room emptied. Whoever wakes it is a new visitor.
bus.on('SESSION_SLEEP', () => {
  current = ''
})
