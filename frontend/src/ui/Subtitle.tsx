import { useStore } from '../state/store.ts'

/**
 * One typographic slot, used by every state so nothing shifts position when a
 * conversation begins. It shows the greeting at rest, the sentence leaving the
 * speaker while they talk, and motion instead of words while they listen or
 * thinks.
 *
 * The user's own speech is never shown. No bubbles, no transcript, no history —
 * a message list would make this a chat application.
 */
export function Subtitle() {
  const { status, subtitle, greeting, error } = useStore()

  return (
    // Floats over the lower part of the frame rather than sitting below it, so
    // they can stand on the bottom edge. The scrim keeps a caption readable where
    // it crosses them, without becoming a panel.
    // Reserves the floor when the prompt rail is up, rather than sharing it.
    //
    // Both components are anchored to `bottom-0` and neither knew about the
    // other, so at rest the greeting was printed straight through the rail: the
    // shop's own opening line crossing "Or just ask out loud", with its last
    // line clipped by the bottom edge of the panel. It is the first thing a
    // visitor reads and it was the most broken thing on the screen.
    //
    // The rail appears in exactly the states below, so this is the same
    // condition read from the other side rather than a guess at its height.
    <div
      className="pointer-events-none from-canvas via-canvas/85 absolute inset-x-0 bottom-0 z-10 flex justify-center bg-linear-to-t to-transparent px-safe pt-24 pb-safe"
      // Inline, not a utility class. `pb-safe` is already on this element and
      // the two are the same property, so which one won came down to their
      // order in the generated stylesheet — it lost, and the greeting stayed
      // printed through the rail.
      style={
        status === 'idle' || status === 'listening'
          ? { paddingBottom: 'clamp(220px, 25vh, 900px)' }
          : undefined
      }
    >
      <div className="w-full max-w-[90%] text-center">{content()}</div>
    </div>
  )

  function content() {
    if (error) {
      // In the same card everything else they say arrives in. It was bare text
      // on the panel, which at display size printed "Microphone access is
      // blocked." straight across their chest — the one moment the interface is
      // admitting a fault is the worst moment to also look broken.
      return (
        <Card>
          <p role="alert" className="text-ink-soft text-body leading-relaxed text-balance">
            {error}
          </p>
        </Card>
      )
    }

    // Boot shows motion, never a progress log. The step name is in the event
    // for the console; putting it on screen would be interface, not presence.
    if (status === 'booting' || status === 'initializing') return <Dots />

    if (status === 'sleeping') return null

    // Listening shows nothing at all. The microphone glows — printing a second
    // indicator of the same fact is interface competing with the person.
    if (status === 'listening') return null
    if (status === 'thinking') return <Dots />

    if (status === 'speaking') {
      // A card rather than text lying on the floor of the panel.
      //
      // The words used to sit directly on the background, which is fine on a
      // monitor and poor on a transparent panel: whatever is physically behind
      // the cabinet shows through mid-sentence, and a passing shopper or a
      // shelf edge lands in the middle of a line. An opaque card is the one
      // place the design deliberately blocks the see-through effect, because
      // legibility of what they are saying outranks it.
      return (
        <Card key={subtitle}>
          <p
            aria-live="polite"
            className="text-ink text-title leading-relaxed font-normal text-balance"
          >
            {subtitle}
          </p>
        </Card>
      )
    }

    // The greeting in the same card their speech arrives in, rather than bare
    // type on the panel.
    //
    // It was set directly on the background, which is fine on a monitor and
    // poor on a transparent one: whatever is physically behind the cabinet
    // shows through the shop's own opening line. The card is the one place this
    // design deliberately blocks the see-through effect, and the first sentence
    // a visitor reads deserves it at least as much as the fifth.
    //
    // Still the display serif, and still two deliberate lines — that is the
    // shop's voice at rest rather than a status line, and it is why `greeting`
    // keeps its newline.
    return (
      <Card>
        <p className="font-display text-ink text-display leading-[1.12] whitespace-pre-line">
          {greeting}
        </p>
      </Card>
    )
  }
}

/**
 * What they are saying, in a card that sits on the panel rather than in it.
 *
 * One component because the greeting, the speech and an error are the same
 * object wearing different words — they used to be three treatments, and the
 * two that were not the speech bubble were bare text printed over the person.
 */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-[rise_var(--duration-calm)_var(--ease-human)] bg-canvas/95 shadow-float mx-auto flex max-w-[80%] items-start gap-[0.8em] rounded-[1.1em] px-[1.3em] py-[1.05em] text-left backdrop-blur-md">
      <Spark />
      {children}
    </div>
  )
}


function Dots() {
  return (
    <div className="flex h-8 items-center justify-center gap-2" role="status" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="bg-ink size-[7px] rounded-full"
          style={{ animation: `dot 1.4s ${i * 180}ms ease-in-out infinite` }}
        />
      ))}
    </div>
  )
}


/**
 * A small mark beside what they are saying, so a card of text reads as speech
 * rather than as a notice taped to the glass.
 *
 * Drawn, not an emoji. The reference used one, and an emoji here would render
 * as a different artist's work on every machine and at a weight nothing else
 * on the panel shares.
 */
function Spark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="text-accent mt-[0.25em] size-[1.1em] shrink-0"
      fill="currentColor"
    >
      <path d="M12 2c.4 4.6 2.4 6.6 7 7-4.6.4-6.6 2.4-7 7-.4-4.6-2.4-6.6-7-7 4.6-.4 6.6-2.4 7-7Z" />
    </svg>
  )
}
