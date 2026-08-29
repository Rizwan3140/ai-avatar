import { bus } from '../bus/bus.ts'
import { httpProvider } from '../provider/http.ts'
import type { AiProvider } from '../provider/provider.types.ts'
import config from '../renderer/renderer.config.ts'
import { useStore } from '../state/store.ts'
import { context, resolve } from './navigation.ts'

/**
 * The Conversation Engine.
 *
 * It hears an utterance and publishes a reply. It does not know what model
 * answers, how the answer is spoken, or what she looks like while answering.
 */
const provider: AiProvider = httpProvider

let inFlight: AbortController | null = null

bus.on('USER_UTTERANCE', ({ text }) => {
  // Resolve what they meant on screen before asking the model anything. "Show me
  // the cheaper one" should move the selection immediately — waiting for a reply
  // to finish streaming makes the screen feel a step behind the conversation.
  const { products, selected } = useStore.getState()
  const nav = resolve(text, products, selected)
  if (nav.kind === 'select') bus.emit('PRODUCT_SELECTED', { product: nav.product })
  if (nav.kind === 'clear') bus.emit('PRODUCTS_CLEARED')
  if (nav.kind === 'tryon') {
    // Select it too, so what he says next is about the garment they asked to
    // wear rather than about whatever was chosen before.
    bus.emit('PRODUCT_SELECTED', { product: nav.product })
    bus.emit('TRYON_REQUESTED', { product: nav.product })
  }

  // Read the state again — resolve may have just changed the selection, and the
  // model needs to know which product "that" now means.
  const after = useStore.getState()
  void run(text, context(after.products, after.selected))
})

// Barge-in during THINKING. Without this the abandoned stream keeps arriving and
// its tail gets spoken over the answer to the new question.
bus.on('USER_STARTED_SPEAKING', () => abort())
bus.on('SESSION_ENDED', () => abort())
bus.on('SESSION_SLEEP', () => abort())

async function run(message: string, onScreen = '') {
  // Silently — a new question supersedes the old request, it does not abandon
  // it. Announcing here would fire REPLY_ABORTED while she is already in
  // THINKING for this very question and drop her straight back out of it.
  abort(false)
  const controller = new AbortController()
  inFlight = controller

  // A person does not answer the instant you stop talking. The pause is what
  // makes thinking read as thinking rather than as lookup.
  await sleep(config.thinkingDelay)
  if (controller.signal.aborted) return

  bus.emit('REPLY_STARTED')

  let reply = ''
  try {
    for await (const chunk of provider.stream(message, controller.signal, onScreen)) {
      if (controller.signal.aborted) return
      reply += chunk
      bus.emit('REPLY_CHUNK', { text: chunk })
    }
  } catch (error) {
    if (controller.signal.aborted) return
    bus.emit('REPLY_ABORTED')
    // The panel is a shop window. The message that used to arrive here was
    // whatever the backend raised — "Cannot reach Ollama at
    // http://127.0.0.1:11434. Is `ollama serve` running?" — rendered at 18px in
    // front of the public. The diagnostic still exists, in the console and in
    // the dev-only transcript; a passer-by gets a sentence a person would say.
    console.error('reply failed:', error)
    bus.emit('SYSTEM_ERROR', { message: "Sorry — I didn't catch that. Ask me again?" })
    return
  } finally {
    if (inFlight === controller) inFlight = null
  }

  // An empty reply must not strand her mid-thought.
  if (!reply.trim()) return bus.emit('REPLY_ABORTED')
  bus.emit('REPLY_COMPLETE', { text: reply })
}

function abort(announce = true) {
  if (!inFlight) return
  inFlight.abort()
  inFlight = null
  if (announce) bus.emit('REPLY_ABORTED')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
