import { bus } from '../bus/bus.ts'
import { useStore } from '../state/store.ts'

/**
 * Four things to say, for the visitor who will not speak first.
 *
 * A cabinet that only listens is a cabinet most people walk past. Standing in a
 * mall saying nothing to a screen, in front of strangers, is a real social cost
 * — and the visitor cannot know what this thing is willing to be asked until
 * they have already risked asking.
 *
 * These are not shortcuts around the conversation. Each one publishes exactly
 * the event the microphone publishes, so it reaches the same model with the
 * same history and comes back spoken aloud in the same voice. Tapping "What is
 * new?" is indistinguishable, downstream, from saying it — which is the only
 * version worth having, because the alternative is a second code path that
 * answers questions differently depending on how they were asked.
 *
 * They disappear the moment he is doing anything, and while the visitor is
 * talking. A row of suggestions under a person mid-sentence reads as an
 * interface interrupting them.
 */

const PROMPTS = [
  { label: 'What is new?', say: 'What is new?' },
  { label: 'Help me choose', say: 'Help me choose something.' },
  { label: 'Try it on', say: 'Can I try something on?' },
  { label: 'Opening hours', say: 'What are your opening hours?' },
]

export function Prompts() {
  const status = useStore((s) => s.status)
  const muted = useStore((s) => s.muted)

  // Only while he is genuinely waiting. `idle` covers a muted cabinet too,
  // which is the one case where these are the only way in at all.
  const offer = status === 'idle' || status === 'listening'
  if (!offer) return null

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-[1.1em] px-safe pb-safe">
      <div className="flex flex-wrap items-center justify-center gap-[0.7em] p-[clamp(14px,1.6vh,58px)]">
        {PROMPTS.map(({ label, say }) => (
          <button
            key={label}
            type="button"
            onClick={() => bus.emit('USER_UTTERANCE', { text: say })}
            className="border-line bg-canvas/80 text-ink text-label hover:border-ink/30 rounded-full border px-[1.4em] py-[0.7em] shadow-sm backdrop-blur-md transition-[transform,border-color,box-shadow] duration-300 ease-(--ease-human) hover:-translate-y-px hover:shadow-md active:translate-y-0"
          >
            {label}
          </button>
        ))}
      </div>

      {/* What the microphone is doing, said plainly. The rail above offers a
          way in; this line says the older one is still open — or, when muted,
          that it is not, which is the whole point of a mute a stranger can
          verify rather than trust. */}
      <p className="text-ink-soft text-label pb-[clamp(10px,1.2vh,44px)] opacity-80">
        {muted ? 'The microphone is off. Tap a question above.' : 'Or just ask out loud.'}
      </p>
    </div>
  )
}
