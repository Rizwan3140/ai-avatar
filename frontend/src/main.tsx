import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './ui/App.tsx'
import { SelfieBooth } from './ui/SelfieBooth.tsx'

/**
 * Three surfaces, one build.
 *
 * `/` is the kiosk — fullscreen, no chrome, boots the whole voice stack.
 * `/selfie` is a photo booth: a character of its own and one thing to do. It
 * shares nothing with the kiosk but this build — no avatar, no session, no
 * microphone — and a cabinet is one or the other by which it was opened at.
 * `/studio` is the dashboard. It is lazy-loaded and its code never reaches a
 * cabinet, and the kiosk's session lifecycle never starts inside the studio.
 */
const Studio = lazy(() => import('./studio/Studio.tsx'))

/**
 * Which surface this is.
 *
 * Only `pathname` was consulted, so `/?studio` and `/#studio` — both of which a
 * person types, and one of which is what a browser leaves behind after a
 * redirect — silently loaded the cabinet instead. That failure is invisible:
 * you get a working showroom screen and a microphone prompt, with nothing
 * saying the address was not understood. Accept the three spellings people
 * actually use and put the URL right, so a bookmark made from here is correct.
 */
const url = new URL(window.location.href)
const path = url.pathname.replace(/\/+$/, '')
const isStudio =
  path === '/studio' ||
  path.startsWith('/studio/') ||
  url.searchParams.has('studio') ||
  url.hash === '#studio'
const isSelfie = !isStudio && path === '/selfie'

// Normalise the shorthands people type, but never flatten a deep link.
// `/studio/avatars` is already correct, and rewriting it to `/studio` here
// would throw away the tab before the studio has even mounted.
if (isStudio && !path.startsWith('/studio')) {
  window.history.replaceState(null, '', '/studio')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isStudio ? (
      <Suspense fallback={null}>
        <Studio />
      </Suspense>
    ) : isSelfie ? (
      <SelfieBooth />
    ) : (
      <App />
    )}
  </StrictMode>,
)

if (!isStudio && !isSelfie) {
  // Booting the kiosk pulls in Whisper, the microphone and the renderer. The
  // studio must not do any of that — and nor must the selfie screen, which has
  // no avatar to identify and no conversation to open.
  void import('./session/lifecycle.ts').then((m) => m.boot())
}
