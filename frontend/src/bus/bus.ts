import type { Events, EventName } from './events.ts'

/** Payload-less events are emitted with one argument, the rest with two. */
type Args<K extends EventName> = Events[K] extends void ? [K] : [K, Events[K]]

const target = new EventTarget()

export const bus = {
  emit<K extends EventName>(...[type, detail]: Args<K>): void {
    target.dispatchEvent(new CustomEvent(type, { detail }))
  },

  /** Returns an unsubscribe function. */
  on<K extends EventName>(type: K, handler: (detail: Events[K]) => void): () => void {
    const listener = (e: Event) => handler((e as CustomEvent).detail)
    target.addEventListener(type, listener)
    return () => target.removeEventListener(type, listener)
  },
}

// Optional chaining because import.meta.env only exists under Vite — the state
// machine is also driven directly by `node --test`.
if (import.meta.env?.DEV) {
  // Step 2 of the build order is "fire events from devtools, watch state".
  // `bus.emit('SESSION_STARTED')` in the console is the whole debugging story.
  ;(globalThis as unknown as { bus: typeof bus }).bus = bus
}
