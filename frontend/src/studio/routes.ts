/**
 * Which tab a URL names, and which URL names a tab.
 *
 * The studio used to live entirely at `/studio`, with the tab held in React
 * state. That meant the address bar said the same thing on every screen: a
 * bookmark always reopened Home, the back button left the studio instead of
 * stepping back a tab, and there was no way to send somebody a link to the
 * thing you were looking at.
 *
 * Everything is under `/studio` rather than at the top level, for two reasons
 * that are not negotiable:
 *
 *   `/` is the cabinet. A kiosk boots to it, and a member of the public stands
 *   in front of it. It must never resolve to a dashboard.
 *
 *   `/avatars` is already the media mount that serves the footage. A tab there
 *   would shadow the files the cabinet plays.
 *
 * Kept as plain functions over `pathname` rather than a router. Nine tabs and
 * no nested routes do not need one, and a dependency here would ship to a
 * cabinet that never opens the studio at all.
 */

export type View =
  | 'home'
  | 'products'
  | 'ads'
  | 'avatars'
  | 'documents'
  | 'kiosks'
  | 'team'
  | 'insights'
  | 'seasons'

export const VIEWS: View[] = [
  'home',
  'products',
  'ads',
  'avatars',
  'documents',
  'kiosks',
  'team',
  'insights',
  'seasons',
]

/**
 * The tab this path names, or Home.
 *
 * Anything unrecognised falls to Home rather than rendering nothing. A typo in
 * an address should land somewhere useful, not on a blank page that looks like
 * the studio is broken.
 */
export function viewFromPath(pathname: string): View {
  const slug = pathname
    .replace(/^\/studio/, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
  return VIEWS.find((v) => v === slug) ?? 'home'
}

/**
 * The path for a tab. Home is `/studio`, not `/studio/home` — the bare address
 * is the one people type and the one the backend redirects a fresh install to,
 * so it has to be the canonical spelling of the front page rather than a
 * synonym for it.
 */
export function pathForView(view: View): string {
  return view === 'home' ? '/studio' : `/studio/${view}`
}
