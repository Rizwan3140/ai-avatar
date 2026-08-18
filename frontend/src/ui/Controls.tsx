import { bus } from '../bus/bus.ts'
import { useStore } from '../state/store.ts'
import { useBurnInShift } from './useBurnInShift.ts'

/**
 * Two controls. Ever. Right edge, middle height, floating.
 *
 * They are filled rather than glass: a translucent white circle on a pure white
 * page has no edge, so the control and its icon both disappear. Filling them is
 * the only way the affordance survives the background.
 */
export function Controls() {
  const status = useStore((s) => s.status)
  const shift = useBurnInShift()

  const live = status !== 'booting' && status !== 'initializing' && status !== 'sleeping'
  const inConversation = live && status !== 'idle'

  return (
    <div
      className="absolute top-1/2 right-safe z-10 flex -translate-y-1/2 flex-col gap-4 transition-transform duration-1000"
      style={{ transform: `translate(${shift.x}px, calc(-50% + ${shift.y}px))` }}
    >
      <ControlButton
        label={inConversation ? 'Conversation active' : 'Start talking'}
        tone="accent"
        disabled={!live}
        glowing={status === 'listening'}
        onClick={() => !inConversation && bus.emit('SESSION_STARTED')}
      >
        {status === 'speaking' ? <SpeakerIcon /> : <MicIcon />}
      </ControlButton>

      <ControlButton
        label="End conversation"
        tone="ink"
        disabled={!inConversation}
        onClick={() => bus.emit('SESSION_ENDED')}
      >
        <StopIcon />
      </ControlButton>
    </div>
  )
}

function ControlButton({
  label,
  tone,
  disabled,
  glowing = false,
  onClick,
  children,
}: {
  label: string
  tone: 'accent' | 'ink'
  disabled: boolean
  glowing?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  // White on #3B82F6 is 3.7:1 and white on #111111 is 18:1 — both clear the 3:1
  // floor for graphical objects, which is the right threshold for an icon.
  const fill = tone === 'accent' ? 'bg-accent' : 'bg-ink'

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      // 48px is both the design spec and the accessibility floor for touch.
      className={`group relative grid size-12 place-items-center overflow-hidden rounded-full text-white shadow-float transition-[transform,opacity] duration-200 ease-(--ease-human) hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100 ${fill}`}
      style={glowing ? { animation: 'glow 1.8s ease-out infinite' } : undefined}
    >
      {/* Press ripple. */}
      <span className="pointer-events-none absolute inset-0 scale-50 rounded-full bg-white/25 opacity-0 transition-[transform,opacity] duration-300 ease-(--ease-human) group-active:scale-100 group-active:opacity-100" />
      <span className="relative">{children}</span>
    </button>
  )
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  )
}

/** Filled, like every stop control anyone has ever used. An outline here would
 *  read as another option rather than as the end of the conversation. */
function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden>
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  )
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5" aria-hidden>
      <path d="M4 9v6h4l5 4V5L8 9H4z" strokeLinejoin="round" />
      <path d="M17 9a4 4 0 0 1 0 6" strokeLinecap="round" />
    </svg>
  )
}
