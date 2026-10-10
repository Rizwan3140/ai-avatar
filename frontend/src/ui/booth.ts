/**
 * The selfie screen's two conversations with the server.
 *
 * Kept apart from `provider/http.ts`, which is the showroom's: that file knows
 * which avatar a cabinet is showing and scopes every call by it. The selfie
 * screen has no avatar. It has a character — a name, a picture and a clip —
 * and nothing here touches the showroom's state.
 */

/** Who a visitor is photographed with, and what this machine can do about it. */
export type Character = {
  id: string
  name: string
  /** Them as the phone sees them, cut out. Empty until one is given. */
  picture: string
  /** Getting ready, played once during the count. Empty until one is given. */
  clip: string
  /** Whether selfies are switched on here at all. */
  available: boolean
  /** Whether a finished selfie can be handed to a phone. */
  share: boolean
}

export async function fetchCharacter(id: string): Promise<Character> {
  if (!id) throw new Error("Open this screen from the studio's Selfie tab.")
  const response = await fetch(`/api/selfie/character/${encodeURIComponent(id)}`)
  if (response.status === 404) throw new Error('That selfie character is no longer here.')
  if (!response.ok) throw new Error('Could not reach the showroom.')
  return response.json()
}

/**
 * "Share to my phone": hand one finished selfie to the server, which holds it
 * in memory for a day so the QR code has something to open.
 *
 * The press is the agreement. It is recorded by the server as a token and
 * spent on this one upload — until this is called the picture has not left
 * the browser.
 */
export async function shareSelfie(photo: Blob, character: string): Promise<string> {
  const unavailable = 'Sharing is not available right now.'
  const agreed = await fetch('/api/selfie/consent', { method: 'POST' })
  if (!agreed.ok) throw new Error(unavailable)
  const { consent } = (await agreed.json()) as { consent: string }
  const asking = new URLSearchParams({ consent, character })
  const response = await fetch(`/api/selfie?${asking}`, {
    method: 'POST',
    body: photo,
    headers: { 'Content-Type': 'application/octet-stream' },
  })
  if (!response.ok) throw new Error(unavailable)
  return ((await response.json()) as { id: string }).id
}
