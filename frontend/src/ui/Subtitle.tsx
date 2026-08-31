import { useStore } from '../state/store.ts'

/**
 * One typographic slot, used by every state so nothing shifts position when a
 * conversation begins. It shows the greeting at rest, the sentence leaving the
 * speaker while she talks, and motion instead of words while she listens or
 * thinks.
 *
 * The user's own speech is never shown. No bubbles, no transcript, no history —
 * a message list would make this a chat application.
 */
export function Subtitle() {
  const { status, subtitle, greeting, error } = useStore()

  return (
    // Floats over the lower part of the frame rather than sitting below it, so
    // he can stand on the bottom edge. The scrim keeps a caption readable where
    // it crosses him, without becoming a panel.
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center bg-linear-to-t from-canvas via-canvas/85 to-transparent px-safe pt-24 pb-safe">
      <div className="w-full max-w-[90%] text-center">{content()}</div>
    </div>
  )

  function content() {
    if (error) {
      return <p className="text-ink-soft text-body">{error}</p>
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
      return (
        <p
          key={subtitle}
          className="text-ink animate-[rise_var(--duration-calm)_var(--ease-human)] text-title leading-relaxed font-normal text-balance"
        >
          {subtitle}
        </p>
      )
    }

    return (
      // The greeting is two deliberate lines, so its newline is honoured.
      //
      // Set in the display serif rather than the interface grotesk. It is what a
      // visitor reads before anyone has spoken — the shop's own voice at rest,
      // not a status line — and it is the only other display-scale sentence on
      // the panel, so it belongs to the same voice as the garment names.
      // What he actually says stays in the grotesk: speech is transient and
      // read at a glance, and a serif caption changing every few seconds is
      // decoration on top of a person.
      <p className="font-display text-ink animate-[rise_var(--duration-calm)_var(--ease-human)] text-display leading-[1.12] whitespace-pre-line">
        {greeting}
      </p>
    )
  }
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
