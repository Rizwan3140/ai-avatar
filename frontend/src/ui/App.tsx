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
 * They are the stage; the merchandise floats over them.
 *
 * Products used to slide in from the right and take 62% of the panel, shrinking
 * them to 42% in the corner — so asking to see a saree cost you most of the
 * person you were asking. Shrinking them to make room below had the same cost
 * in the other direction: the person asked stopped being full height the moment
 * they answered. The panel is 2160x3840, nearly twice as tall as it is wide, so
 * there is room for both without either giving way — the shelf now floats,
 * translucent, over the lower part of the frame they never stood clear of.
 */
export function App() {
  const sleeping = useStore((s) => s.status === 'sleeping')
  const hasCampaigns = useStore((s) => s.hasCampaigns)

  return (
    <main className="kiosk-root bg-canvas relative flex h-full flex-col overflow-hidden">
      {/* The stage. Everything that is *them* floats inside this, full height
          always — the shelf now floats on top of it rather than claiming a row
          beneath it, so nothing here shrinks to make room. */}
      <div className="relative min-h-0 flex-1">
        <Mp4VideoRenderer />
        <Masthead />
        <Signage />
        <Subtitle />
        <Prompts />
        <Controls />
      </div>

      {/* Rendered after the stage, so it paints on top — `Showcase` positions
          itself absolutely against this `<main>`. */}
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
