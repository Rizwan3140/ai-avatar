import { create } from 'zustand'
import { bus } from '../bus/bus.ts'
import type { Emotion, Product } from '../bus/events.ts'

export type Status =
  | 'booting'
  | 'initializing'
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'sleeping'

type State = {
  status: Status
  emotion: Emotion
  /** The one line under her — the sentence leaving the speaker right now. */
  subtitle: string
  /** The avatar's id — its folder name, not its display name. */
  avatarId: string
  name: string
  greeting: string
  initStep: string
  error: string | null
  /** The visitor has taken the microphone away. The session is still open;
   *  he simply cannot hear the room until it comes back. */
  muted: boolean

  /** Products on screen. Empty means he has the whole display to himself. */
  products: Product[]
  /** The one being discussed — what "this" and "that one" refer to. */
  selected: Product | null

  /**
   * Whether this cabinet can offer to photograph a visitor, and whether that
   * photo leaves the room. Both matter to the UI: the first decides whether a
   * button exists at all, the second is part of what the person is consenting to
   * and has to be said out loud on the consent screen.
   */
  tryon: { available: boolean; provider: string; on_device: boolean }
}

/**
 * The State Manager. Derived entirely from bus events — the UI reads it and
 * never writes to it. Every transition below is a rule about how a conversation
 * feels, so they are all in one place rather than scattered across modules.
 */
export const useStore = create<State>(() => ({
  status: 'booting',
  emotion: 'neutral',
  subtitle: '',
  avatarId: '',
  name: '',
  greeting: '',
  initStep: '',
  error: null,
  muted: false,
  products: [],
  selected: null,
  // Off until the kiosk says otherwise. A camera that appears by default because
  // a flag failed to load is the wrong direction for this one to fail in.
  tryon: { available: false, provider: '', on_device: false },
}))

const set = useStore.setState

bus.on('SYSTEM_INITIALIZING', ({ step }) => set({ status: 'initializing', initStep: step }))
// Ready means boot finished, not that boot succeeded. Clearing the error here
// erased the offline banner a moment after it appeared — the kiosk then looked
// healthy while serving nothing.
bus.on('SYSTEM_READY', () => set({ status: 'idle', initStep: '' }))
bus.on('SYSTEM_ERROR', ({ message }) => set({ error: message }))

// The mic stays hot for the whole conversation, so a session begins in
// listening and returns there after every reply. Idle means no conversation.
bus.on('SESSION_STARTED', () => set({ status: 'listening', subtitle: '', muted: false }))
bus.on('SESSION_ENDED', () =>
  set({ status: 'idle', subtitle: '', emotion: 'neutral', muted: false }),
)
bus.on('SESSION_SLEEP', () => set({ status: 'sleeping', subtitle: '', muted: false }))

// Muting drops him to idle rather than leaving him poised to listen. Standing
// attentively at someone who has just switched the microphone off is the
// unsettling version — idle is him waiting, which is what is actually true.
//
// The status is the same 'idle' as no-conversation, so the sleep timer arms and
// a cabinet left muted eventually sleeps. That is the right outcome for the
// panel; `muted` is what keeps the controls reachable in the meantime.
bus.on('MIC_MUTED', ({ muted }) =>
  set({ muted, status: muted ? 'idle' : 'listening', subtitle: '' }),
)
bus.on('SESSION_WAKE', () => set({ status: 'idle', subtitle: '' }))

bus.on('USER_STARTED_SPEAKING', () => set({ status: 'listening', subtitle: '' }))
bus.on('USER_UTTERANCE', () => set({ status: 'thinking' }))

bus.on('SPEECH_STARTED', () => set({ status: 'speaking' }))
bus.on('SPEECH_SENTENCE', ({ text }) => set({ subtitle: text }))
bus.on('SPEECH_ENDED', () => set({ status: 'listening', subtitle: '' }))
bus.on('SPEECH_CANCELLED', () => set({ subtitle: '' }))

// A reply that produced no speech (empty or aborted) must not strand her in
// thinking — she would stand there considering forever.
bus.on('REPLY_ABORTED', () => {
  if (useStore.getState().status === 'thinking') set({ status: 'listening' })
})

bus.on('EMOTION_CHANGED', ({ emotion }) => set({ emotion }))

// Products appear only when asked for, and a single result selects itself —
// nobody says "show me the Titan Pro" and then wants to tap it as well.
bus.on('PRODUCTS_SHOWN', ({ products }) => {
  // A selection survives a refreshed result list if the product is still in it.
  //
  // "Tell me about the linen shirt" does two things at once: navigation resolves
  // it to a selection immediately, and the same utterance goes to the catalog and
  // comes back with its own results a moment later. Overwriting the selection
  // here threw the first away — the detail view opened and then bounced straight
  // back to the grid the visitor had just chosen from.
  const current = useStore.getState().selected
  const survivor = current && products.some((p) => p.id === current.id) ? current : null
  set({ products, selected: survivor ?? (products.length === 1 ? products[0] : null) })
})
bus.on('PRODUCT_SELECTED', ({ product }) => {
  const { avatarId } = useStore.getState()
  set({ selected: product })
  // Opening a product is a stronger signal than it appearing in a list. Fire and
  // forget — a metric must never delay or break a conversation. The avatar id
  // goes along so the event is filed against the right company.
  void fetch(
    `/api/analytics/viewed/${encodeURIComponent(product.id)}?avatar=${encodeURIComponent(avatarId)}`,
    { method: 'POST' },
  ).catch(() => {})
})
bus.on('PRODUCT_DESELECTED', () => set({ selected: null }))
bus.on('PRODUCTS_CLEARED', () => set({ products: [], selected: null }))
// Ending the conversation returns the screen to him alone.
bus.on('SESSION_ENDED', () => set({ products: [], selected: null }))

export function setIdentity(avatarId: string, name: string, greeting: string) {
  set({ avatarId, name, greeting })
}

export function setTryOn(tryon: State['tryon']) {
  set({ tryon })
}
