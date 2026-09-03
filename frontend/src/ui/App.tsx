import { Mp4VideoRenderer } from '../renderer/Mp4VideoRenderer.tsx'
import { Masthead } from './Masthead.tsx'
import { Prompts } from './Prompts.tsx'
import { useStore } from '../state/store.ts'
import { Controls } from './Controls.tsx'
import { Showcase } from './Showcase.tsx'
import { Signage } from './Signage.tsx'
import { Subtitle } from './Subtitle.tsx'
import { Transcript } from './Transcript.tsx'

/**
 * He gets the whole screen. Everything else floats on top of it.
 *
 * The layout deliberately reserves no space of its own — a row for captions
 * under his feet would leave him hovering above the floor of the cabinet, which
 * is the one thing a standing person never does.
 */
export function App() {
  const sleeping = useStore((s) => s.status === 'sleeping')
  const showcase = useStore((s) => s.products.length > 0)

  return (
    <main className="relative h-full overflow-hidden bg-canvas">
      {/* He shrinks aside rather than leaving. The visitor is still being helped
          by someone, not left browsing a website. */}
      <div
        className="absolute inset-0 origin-bottom-left transition-transform duration-500 ease-(--ease-human)"
        style={{ transform: showcase ? 'scale(0.42)' : 'scale(1)' }}
      >
        <Mp4VideoRenderer />
      </div>

      <Masthead />
      <Signage />
      <Showcase />
      <Subtitle />
      <Prompts />
      <Controls />
      <Transcript />

      {/* Sleep fades to true black, not white — an OLED panel showing black is
          off, which is what protects it over months of standby. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-1000 ease-(--ease-human)"
        style={{ opacity: sleeping ? 1 : 0 }}
      />
    </main>
  )
}
