/**
 * One way to talk to the platform, so the token is attached in one place.
 *
 * The token lives in `localStorage` rather than a cookie: the studio is a
 * separate surface from the kiosk, there is no cross-site form to protect, and a
 * bearer header cannot be sent by a third-party page the way a cookie can. It
 * expires server-side regardless of what is kept here.
 */

const KEY = 'luxora-studio-token'

export type Principal = {
  user_id: string
  email: string
  org_id: string
  role: 'owner' | 'editor' | 'viewer'
}

export type Org = { id: string; name: string; vertical: string }

/** Mirrors `store.Avatar`, plus the two derived fields the API adds. */
export type Avatar = {
  id: string
  name: string
  persona: string
  greeting: string
  language: string
  voice: string
  renderer: string
  org_id: string
  poster: string
  clips: Record<string, string>
  ready: boolean
  missing_clips: string[]
}

export type Kiosk = { id: string; avatar_id: string; label: string; org_id: string }

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

export type Campaign = {
  id: string
  src: string
  kind: string
  invitation: string
  starts: string
  ends: string
  seconds: number
}

export type Document = { source: string; passages: number; characters: number }

export type TryOnStatus = {
  available: boolean
  provider: string
  options: string[]
  on_device: boolean
}

export const POSES = ['idle', 'listen', 'think', 'speak'] as const

export function token(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return '' // Private browsing. Sign-in still works, it just will not persist.
  }
}

export function setToken(value: string): void {
  try {
    if (value) localStorage.setItem(KEY, value)
    else localStorage.removeItem(KEY)
  } catch {
    /* nothing to do — the session survives until reload */
  }
}

export class ApiError extends Error {
  // A plain field, assigned in the body: parameter properties are TypeScript-only
  // syntax, and this project builds by erasing types rather than transforming them.
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type Options = {
  method?: string
  body?: unknown
  /** Raw bytes — a photo, a CSV. Sent as-is with no JSON wrapping. */
  raw?: BodyInit
  headers?: Record<string, string>
}

async function request(path: string, options: Options = {}): Promise<Response> {
  const { method = 'GET', body, raw, headers = {} } = options
  const auth = token()

  const response = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...headers,
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })

  if (response.status === 401) {
    // The token expired or was signed by a platform this is no longer talking
    // to. Clearing it here means the next render shows a sign-in form rather
    // than a wall of failed panels.
    setToken('')
  }

  if (!response.ok) {
    // FastAPI puts the useful sentence in `detail`. Falling back to the status
    // gives "500" rather than "[object Object]".
    const detail = await response
      .json()
      .then((body) => (typeof body?.detail === 'string' ? body.detail : ''))
      .catch(() => '')
    throw new ApiError(detail || `Request failed (${response.status})`, response.status)
  }

  return response
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const response = await request(path, options)
  return response.status === 204 ? (undefined as T) : response.json()
}

export async function apiBlob(path: string, options: Options = {}): Promise<Blob> {
  return (await request(path, options)).blob()
}

/** Raw file upload. Bytes on the body — the API takes no multipart anywhere. */
export function upload<T>(path: string, file: File | Blob, filename?: string): Promise<T> {
  const name = filename ?? (file instanceof File ? file.name : 'upload')
  const separator = path.includes('?') ? '&' : '?'
  return api<T>(`${path}${separator}filename=${encodeURIComponent(name)}`, {
    method: 'POST',
    raw: file,
    headers: { 'Content-Type': 'application/octet-stream' },
  })
}
