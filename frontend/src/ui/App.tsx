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
 * They are the stage; the merchandise sits beneath them.
 *
 * Products used to slide in from the right and take 62% of the panel, shrinking
 * them to 42% in the corner — so asking to see a saree cost you most of the
 * person you were asking, and the two halves fought over the same edge. The
 * panel is 2160x3840, nearly twice as tall as it is wide, and a portrait screen
 * wants a column: them above, what they are showing below, both full width.
 *
 * The stage still reserves no space under their feet. They stands on the floor of
 * their own frame and the shelf begins below it, rather than a caption row
 * leaving them hovering — which is the one thing a standing person never does.
 */
export function App() {
  const sleeping = useStore((s) => s.status === 'sleeping')
  const showcase = useStore((s) => s.products.length > 0)
  const hasCampaigns = useStore((s) => s.hasCampaigns)

  return (
    <main className="kiosk-root bg-canvas flex h-full flex-col overflow-hidden">
      {/* The stage. Everything that is *them* floats inside this, so the shelf
          below can never be painted over by a caption or a control — which is
          what the whole `z-20` argument between the prompt rail and the QR card
          was about when both were absolutely positioned on one plane. */}
      <div
        className="relative min-h-0 flex-1 transition-[flex-grow] duration-700 ease-(--ease-human)"
        style={{ flexGrow: showcase ? 0.85 : 1 }}
      >
        <Mp4VideoRenderer />
        <Masthead />
        <Signage />
        <Subtitle />
        <Prompts />
        <Controls />
      </div>

      <Showcase />
      <Transcript />

      {/* Sleep fades to true black, not white — an OLED panel showing black is
          off, which is what protects it over months of standby.

          Unless there is something to advertise. This scrim is painted last, so
          it covered the signage that sleep is meant to be running: the
          campaigns played correctly underneath a black rectangle, and the
          feature looked like it had never been built. A cabinet with campaigns
          sleeps as a billboard; one without sleeps as a dark panel, which is
          still the right answer to having nothing to show. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-1000 ease-(--ease-human)"
        style={{ opacity: sleeping && !hasCampaigns ? 1 : 0 }}
      />
    </main>
  )
}
