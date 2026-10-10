import { bus } from '../bus/bus.ts'
import { Mp4VideoRenderer } from '../renderer/Mp4VideoRenderer.tsx'
import { useStore } from '../state/store.ts'
import { Masthead } from './Masthead.tsx'
import { Selfie } from './Selfie.tsx'

/**
 * The selfie screen: them, and one thing to do.
 *
 * Its own page, at `/selfie`, rather than a chip under the showroom avatar.
 * There it was a fifth thing to tap beside four questions about merchandise,
 * and a sentence the conversation had to be taught not to answer. Here a
 * cabinet is either a showroom or a photo booth, and whoever set it up chose
 * which by the address they opened.
 *
 * No microphone, no shelf, no prompts: nothing on this page listens.
 */
export function SelfieBooth() {
  const name = useStore((s) => s.name)
  const offered = useStore((s) => s.selfie.available)
  const ready = useStore((s) => !['booting', 'initializing'].includes(s.status))
  const posing = useStore((s) => s.posing)

  return (
    <main className="kiosk-root bg-canvas relative flex h-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1">
        <Mp4VideoRenderer />
        <Masthead />
      </div>

      {/* A camera, at the right edge, halfway up — where the showroom screen
          keeps its microphone, so the one thing to press is where a hand
          already goes. It was a sentence across the bottom, over their feet.
          Out of the way for the count; the cards the selfie itself puts up
          are painted above it. */}
      {ready && !posing && offered && (
        <button
          type="button"
          onClick={() => bus.emit('SELFIE_REQUESTED')}
          aria-label={`Take a selfie with ${name || 'me'}`}
          className="lay-down bg-ink shadow-float absolute top-1/2 right-safe z-20 grid size-[clamp(56px,6.5vh,240px)] -translate-y-1/2 place-items-center rounded-full text-white transition-transform duration-300 ease-(--ease-human) hover:scale-105 active:scale-95"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="size-[46%]"
          >
            <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2.5h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
            <circle cx="12" cy="13" r="3.3" />
          </svg>
        </button>
      )}
      {ready && !offered && (
        <p className="text-ink-soft text-label absolute inset-x-0 bottom-0 z-20 px-safe pb-safe text-center">
          Selfies are switched off on this machine.
        </p>
      )}

      <Selfie />
    </main>
  )
}
