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

      {/* Out of the way for the count: they are posing over this space. The
          cards the selfie itself puts up are painted above it. */}
      {ready && !posing && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-[0.8em] px-safe pb-safe">
          {offered ? (
            <button
              type="button"
              onClick={() => bus.emit('SELFIE_REQUESTED')}
              className="lay-down bg-ink text-body shadow-float rounded-full px-[2em] py-[0.9em] font-medium text-white transition-transform duration-300 ease-(--ease-human) hover:-translate-y-[2px] active:translate-y-0 active:scale-[0.98]"
            >
              Take a selfie with {name || 'me'}
            </button>
          ) : (
            <p className="text-ink-soft text-label">Selfies are switched off on this machine.</p>
          )}
        </div>
      )}

      <Selfie />
    </main>
  )
}
