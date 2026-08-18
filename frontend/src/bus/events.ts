/** Emotion is carried from day one; no v1 renderer acts on it. See renderer/. */
export type Emotion = 'neutral' | 'happy' | 'interested' | 'concerned'

/**
 * The whole vocabulary of the system. Modules publish and subscribe to these and
 * hold no references to each other.
 */
export type Events = {
  SYSTEM_BOOT: void
  SYSTEM_INITIALIZING: { step: string }
  SYSTEM_READY: void
  SYSTEM_ERROR: { message: string }

  SESSION_STARTED: void
  SESSION_ENDED: void
  SESSION_SLEEP: void
  SESSION_WAKE: void

  USER_STARTED_SPEAKING: void
  USER_UTTERANCE: { text: string }
  USER_SILENT: void
  /** The turn so far, including words still forming. Diagnostic only. */
  USER_INTERIM: { text: string }
  /** Whether the recogniser is actually running, and why it stopped if not. */
  RECOGNITION_STATE: { running: boolean; error?: string }
  /** Live microphone energy, 0 to 1. Drives the level meter. */
  MIC_LEVEL: { level: number }
  /** Voice activity detection crossing its threshold, and what it captured. */
  VOICE_ACTIVITY: { speaking: boolean; durationMs: number; peak: number }
  /** Heard, then thrown away. The only way to see the echo filter working. */
  USER_DISCARDED: { text: string; reason: 'echo' }

  REPLY_STARTED: void
  REPLY_CHUNK: { text: string }
  REPLY_COMPLETE: { text: string }
  REPLY_ABORTED: void

  SPEECH_STARTED: void
  SPEECH_SENTENCE: { text: string }
  SPEECH_ENDED: void
  SPEECH_CANCELLED: void

  EMOTION_CHANGED: { emotion: Emotion }

  /** Products the catalog returned for what the visitor just asked. */
  PRODUCTS_SHOWN: { products: Product[] }
  /** One product moved to the front — by touch, or by being talked about. */
  PRODUCT_SELECTED: { product: Product }
  /** Back to the results. Distinct from clearing them, which throws away the search. */
  PRODUCT_DESELECTED: void
  /** Back to the digital human, full size. */
  PRODUCTS_CLEARED: void
  /**
   * The visitor asked to see something on themselves. Carries the product, not
   * a command to open a camera — the consent screen is what opens, and only the
   * person in front of it can take it further.
   */
  TRYON_REQUESTED: { product: Product }
}

/** Core fields every vertical shares; the rest arrives in `attributes`. */
export type Product = {
  id: string
  name: string
  category: string
  price: number | null
  currency: string
  spoken_price: string
  description: string
  url: string
  image: string
  availability: string
  attributes: Record<string, string>
}

export type EventName = keyof Events
