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

const isStudio = window.location.pathname.startsWith('/studio')

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
