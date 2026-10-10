import { bus } from '../bus/bus.ts'
import { sessionId } from '../session/session.ts'
import type { Product, Shelves } from '../bus/events.ts'
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
  // Each id is percent-encoded by the server — a sku can hold a comma or Telugu.
  const wanted = ids.split(',').filter(Boolean).flatMap((id) => {
    try {
      return [decodeURIComponent(id)]
    } catch {
      return []
    }
  })
  // A turn that matched nothing leaves the screen alone. It used to empty it,
  // which meant every sentence that was not itself a product search swept the
  // merchandise away: "what is it made of", "how much is that one", "thanks" —
  // a visitor asking about the saree in front of them watched it disappear
  // while they were asking. The shelf is cleared deliberately, by saying so or
  // by the Back button, and those two paths still do it.
  if (!wanted.length) return

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
    // A failed lookup must not interrupt the conversation. They keeps talking;
    // the screen just does not change.
  }
}

/**
 * A department's shelves, put up as tiles to choose from.
 *
 * The chat reply names only the department ("men"); the tiles — a shelf, a
 * count and a picture each — are fetched here, so the header stays an id and
 * a shop with thirty shelves does not travel in one.
 */
export async function showShelves(department: string, back?: Shelves, color = ''): Promise<void> {
  const asking = scope()
  if (asking === null) return
  // "Black men's wear": only the shelves with something black on them.
  const tinted = color ? `&color=${encodeURIComponent(color)}` : ''
  try {
    const response = await fetch(
      `/api/products/shelves?department=${encodeURIComponent(department)}${tinted}&${asking}`,
    )
    if (!response.ok) return
    const shelves = (await response.json()) as Shelves
    // `back` when one set of tiles led here — the Accessories tile under
    // Jewellery — so these have a way back to those.
    if (shelves.shelves?.length) bus.emit('SHELVES_SHOWN', { ...shelves, back })
  } catch {
    // The same rule as a failed product lookup: they keep talking, the screen
    // just does not change.
  }
}

/** How many of a shelf a tapped tile lays out. A browse, so more than a spoken
 *  request's eight; the strip scrolls. */
const SHELF_LIMIT = 24

/**
 * A tile was tapped: that shelf, within that department.
 *
 * Both, because a shelf alone is not the tile. This shop's Pants shelf holds
 * women's pieces and a men's one, and the men's tile has to open the men's.
 * Fetched directly rather than said to the model: a tap on something already on
 * screen is a choice, the same as tapping a product, and it must always open
 * exactly that.
 */
export async function openShelf(department: string, category: string, color = ''): Promise<void> {
  const asking = scope()
  if (asking === null) return
  const query = new URLSearchParams({ department, category, limit: String(SHELF_LIMIT) })
  // The tiles were for a colour, so the shelf opens on that colour.
  if (color) query.set('color', color)
  try {
    const response = await fetch(`/api/products?${query}&${asking}`)
    if (!response.ok) return
    const products = (await response.json()) as Product[]
    if (products.length) bus.emit('PRODUCTS_SHOWN', { products, fromShelf: true })
  } catch {
    // The tiles stay up; tapping again is the retry.
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
 * written to disk at either end.
 *
 * The consent token is issued by the server when the visitor agrees, and spent
 * here. It used to be the literal `consent=1`, typed into every request by this
 * function — which proved a client had been written, never that a person had
 * said yes.
 */
export async function requestConsent(): Promise<string> {
  const response = await fetch('/api/tryon/consent', { method: 'POST' })
  if (!response.ok) throw new Error('Try-on is not available right now.')
  return (await response.json()).consent as string
}

export async function tryOnProduct(
  productId: string,
  photo: Blob,
  consent: string,
): Promise<Blob> {
  const asking = scope()
  if (asking === null) throw new Error('This cabinet has not been set up yet.')
  if (!consent) throw new Error('That agreement has expired. Please ask again.')
  const response = await fetch(
    `/api/tryon/${encodeURIComponent(productId)}?consent=${encodeURIComponent(consent)}&${asking}`,
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
      body: JSON.stringify({
        message,
        context,
        session: sessionId(),
        // The avatar is the tenant boundary for the conversation. The server
        // can only resolve the right persona and catalog when the browser sends
        // the identity it booted with.
        avatar_id: useStore.getState().avatarId,
      }),
      signal,
    })

    if (!response.ok || !response.body) {
      throw new Error(`Chat request failed (${response.status})`)
    }

    // Which products the catalog matched, on the response header rather than in
    // the body — the screen can fill before the first word is spoken.
    // Before the new products land, so "the next one" means the list the
    // visitor was looking at when they said it.
    const heardAs = response.headers.get('X-Heard-As')
    if (heardAs) {
      try {
        bus.emit('USER_UTTERANCE_TRANSLATED', { text: decodeURIComponent(heardAs) })
      } catch {
        // A malformed header costs one navigation, never the reply.
      }
    }

    const ids = response.headers.get('X-Products')
    if (ids !== null) void showProducts(ids)

    // "Men's wear" on its own: no products, a department to choose within.
    const department = response.headers.get('X-Shelves')
    // With a colour beside it, "black men's wear": the shelves holding that.
    let color = ''
    try {
      color = decodeURIComponent(response.headers.get('X-Shelves-Color') ?? '')
    } catch {
      // A malformed header costs the filter, never the tiles.
    }
    if (department) void showShelves(department, undefined, color)

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
  /** "studio" on a machine somebody works at, "kiosk" on a cabinet. Decides
   *  whether the wordmark on the panel is a way back to the dashboard — on a
   *  cabinet it must not be, because the public is standing in front of it. */
  home?: string
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
  return { avatar: await avatar.json(), tryon: await tryon.json() }
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
