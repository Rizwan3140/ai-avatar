import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './ui/App.tsx'

/**
 * Two surfaces, one build.
 *
 * `/` is the kiosk — fullscreen, no chrome, boots the whole voice stack.
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
const isStudio =
  url.pathname.replace(/\/+$/, '').endsWith('/studio') ||
  url.searchParams.has('studio') ||
  url.hash === '#studio'

if (isStudio && url.pathname !== '/studio') {
  window.history.replaceState(null, '', '/studio')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isStudio ? (
      <Suspense fallback={null}>
        <Studio />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)

if (!isStudio) {
  // Booting the kiosk pulls in Whisper, the microphone and the renderer. The
  // studio must not do any of that.
  void import('./session/lifecycle.ts').then((m) => m.boot())
}
