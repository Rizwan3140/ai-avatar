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
 * They disappear the moment they are doing anything, and while the visitor is
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

  // Only while they are genuinely waiting. `idle` covers a muted cabinet too,
  // which is the one case where these are the only way in at all.
  const offer = status === 'idle' || status === 'listening'
  if (!offer) return null

  // Full width again. These used to stop short of the showcase panel to keep
  // off its QR code — both sat at `z-20` on one plane and this painted second,
  // so the buttons won. The shelf is below the stage now and cannot be reached
  // from in here, so there is nothing left to dodge.
  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-[1.1em] px-safe pb-safe">
      {/* Two by two, not a row that wraps.
          At cabinet scale each chip is a couple of hundred pixels wide, so four
          across never fit and the fourth dropped to a line of its own —
          three-and-one, which reads as a layout that ran out of room rather
          than a set of four things offered deliberately. */}
      <div className="grid grid-cols-2 gap-[0.7em] p-[clamp(14px,1.6vh,58px)]">
        {PROMPTS.map(({ label, say }, i) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              // A prompt is a way into the same conversation, not a shortcut
              // around it. Start the session first so the voice engine and
              // history are ready before the utterance reaches the model.
              if (status === 'idle') {
                if (muted) bus.emit('MIC_MUTED', { muted: false })
                else bus.emit('SESSION_STARTED')
              }
              bus.emit('USER_UTTERANCE', { text: say })
            }}
            // Arriving in sequence, like the products do. Four things appearing
            // at once is a toolbar; four arriving one after another is an offer
            // being made.
            className="lay-down border-line/80 bg-canvas/70 text-ink text-label hover:border-ink/25 rounded-full border px-[1.4em] py-[0.75em] text-center whitespace-nowrap shadow-sm backdrop-blur-md transition-[transform,border-color,box-shadow,background-color] duration-300 ease-(--ease-human) hover:bg-canvas/90 hover:-translate-y-[2px] hover:shadow-md active:translate-y-0 active:scale-[0.98]"
            style={{ animationDelay: `${i * 70}ms` }}
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
