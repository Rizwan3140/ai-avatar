import { bus } from '../bus/bus.ts'
import { sessionId } from '../session/session.ts'
import type { Product } from '../bus/events.ts'
import { useStore } from '../state/store.ts'
import type { AiProvider } from './provider.types.ts'

/**
 * Which catalog this cabinet is looking at.
 *
 * The server resolves the org from the avatar rather than trusting an org id off
 * the query string, so every catalog read has to say which avatar is asking.
 * Without it a second company's cabinet reads the first company's products.
 */
export function scope(): string | null {
  const { avatarId } = useStore.getState()
  // No identity means the boot call failed. Asking anyway lets the server pick
  // a default org, which on a two-tenant box is the other company's catalog —
  // quoted out loud by the avatar. Refuse instead.
  return avatarId ? `avatar=${encodeURIComponent(avatarId)}` : null
}

/** Fetch the matched products and put them on screen. */
async function showProducts(ids: string): Promise<void> {
  const wanted = ids.split(',').filter(Boolean)
  if (!wanted.length) return bus.emit('PRODUCTS_CLEARED')

  const asking = scope()
  if (asking === null) return

  try {
    const found = await Promise.all(
      wanted.map((id) =>
        fetch(`/api/products/${encodeURIComponent(id)}?${asking}`).then((r) =>
          r.ok ? r.json() : null,
        ),
      ),
    )
    const products = found.filter(Boolean) as Product[]
    if (products.length) bus.emit('PRODUCTS_SHOWN', { products })
  } catch {
    // A failed lookup must not interrupt the conversation. He keeps talking;
    // the screen just does not change.
  }
}

export async function searchProducts(query: string): Promise<Product[]> {
  const asking = scope()
  if (asking === null) return []
  const response = await fetch(`/api/products?q=${encodeURIComponent(query)}&${asking}`)
  return response.ok ? response.json() : []
}

/**
 * A photograph of the visitor, wearing what is on screen.
 *
 * The image goes up on the request body and comes back as an image. It is never
 * written to disk at either end, and consent is a query parameter with no
 * default — a request without it is refused rather than assumed.
 */
export async function tryOnProduct(productId: string, photo: Blob): Promise<Blob> {
  const asking = scope()
  if (asking === null) throw new Error('This cabinet has not been set up yet.')
  const response = await fetch(
    `/api/tryon/${encodeURIComponent(productId)}?consent=1&${asking}`,
    { method: 'POST', body: photo, headers: { 'Content-Type': 'application/octet-stream' } },
  )
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body) => (typeof body?.detail === 'string' ? body.detail : ''))
      .catch(() => '')
    throw new Error(detail || 'Try-on is not available right now.')
  }
  return response.blob()
}

/** Talks to the FastAPI proxy, which holds the API key. A kiosk is physically
 *  accessible, so the key never reaches the browser. */
export const httpProvider: AiProvider = {
  async *stream(message: string, signal: AbortSignal, context = ''): AsyncIterable<string> {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, context, session: sessionId() }),
      signal,
    })

    if (!response.ok || !response.body) {
      throw new Error(`Chat request failed (${response.status})`)
    }

    // Which products the catalog matched, on the response header rather than in
    // the body — the screen can fill before the first word is spoken.
    const ids = response.headers.get('X-Products')
    if (ids !== null) void showProducts(ids)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        if (text) yield text
      }
    } finally {
      reader.cancel().catch(() => {})
    }
  },
}

export type KioskConfig = {
  kiosk: { id: string; avatar_id: string; label: string }
  avatar: {
    id: string
    name: string
    greeting: string
    /** "male" | "female" | "" — decides which browser voice speaks. */
    gender: string
    /** An exact voice name, overriding gender. */
    voice: string
    language: string
    poster: string
    clips: Record<string, string>
  }
  /** Whether to offer a camera at all, and whether the photo leaves the room. */
  tryon: { available: boolean; provider: string; on_device: boolean }
  /** Token overrides for the season in force today. Absent means the everyday
   *  look, which is the tokens already compiled into the stylesheet. */
  season?: Record<string, string>
}

/**
 * One named avatar, for the Studio's "talk to this avatar" link.
 *
 * Same shape as `fetchKiosk` minus the kiosk row, so `boot()` destructures the
 * result identically either way. `/api/avatar` 404s on an id it does not know
 * and only falls back to the default when the id is *empty* — so a mistyped
 * link fails loudly instead of quietly showing somebody else's avatar.
 */
export async function fetchAvatar(avatarId: string): Promise<Omit<KioskConfig, 'kiosk'>> {
  const [avatar, tryon] = await Promise.all([
    fetch(`/api/avatar?id=${encodeURIComponent(avatarId)}`),
    fetch('/api/tryon'),
  ])
  if (!avatar.ok) throw new Error('That avatar is no longer here.')
  // The season rides on the avatar here, the kiosk row there. Same screen.
  const { season, ...rest } = await avatar.json()
  return { avatar: rest, tryon: await tryon.json(), season }
}

/** Who this cabinet is. Replaces the avatar name the app used to be built with. */
export async function fetchKiosk(kioskId: string): Promise<KioskConfig> {
  const response = await fetch(`/api/kiosk/${encodeURIComponent(kioskId)}`)
  // 404 here means the platform answered and has nobody to show — a fresh
  // install, or an avatar that was deleted out from under a running cabinet.
  // Telling that person the showroom is offline sends them to check a network
  // that is working perfectly.
  if (response.status === 404) throw new Error('EMPTY')
  if (!response.ok) throw new Error('Could not reach the showroom.')
  return response.json()
}

export async function resetConversation(session: string): Promise<void> {
  await fetch('/api/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
  }).catch(() => {})
}
