import { useEffect, useState } from 'react'
import { useStore } from '../state/store.ts'

/**
 * The band across the top of the cabinet: who this is, that it is awake, and
 * the time.
 *
 * The panel had no top. It opened on the avatar's head with nothing above it,
 * which is right for the illusion and wrong for a shop window — a passer-by
 * could not tell whose showroom this was, or whether the screen was a video
 * playing to nobody.
 *
 * It stays deliberately thin. Anything taller starts competing with the person
 * standing behind it, and the person is the product.
 */
export function Masthead({ name }: { name?: string }) {
  const status = useStore((s) => s.status)
  const studioReachable = useStore((s) => s.studioReachable)
  const sleeping = status === 'sleeping'

  return (
    <header
      aria-hidden={sleeping}
      // One row, always. This stacked and dropped the clock because the band
      // shrank to a third of the panel whenever products appeared — the shelf
      // sits below the stage now, so the header keeps its full width and none
      // of that is needed.
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 px-safe pt-safe transition-opacity duration-700 ease-(--ease-human)"
      style={{ opacity: sleeping ? 0 : 1 }}
    >
      {/*
        The wordmark is a way back to the dashboard — but only on a machine that
        has one. On a cabinet it stays exactly what it was: text, unclickable,
        because a member of the public standing at a shop window must not be one
        tap from the studio. `pointer-events` is re-enabled on this element
        alone; the header itself stays transparent to touch so the panel behind
        it still wakes.
      */}
      <div
        // `min-w-0` so the name yields first. With the products up this band is
        // a third of its width, the wordmark wraps to two lines, and without
        // this the status was pushed past the panel edge and sliced to "Lis".
        // Of the two, the one a visitor needs is whether it is listening.
        className={`flex min-w-0 flex-col gap-[0.2em] p-[clamp(14px,1.6vh,58px)] ${
          studioReachable ? 'pointer-events-auto' : ''
        }`}
      >
        {studioReachable ? (
          <a href="/studio" aria-label={`${name ?? 'Dhiyona'} — back to the studio`}>
            <span className="font-display text-title leading-none tracking-[0.14em] uppercase">
              {name ?? 'Dhiyona'}
            </span>
          </a>
        ) : (
          <span className="font-display text-title leading-none tracking-[0.14em] uppercase">
            {name ?? 'Dhiyona'}
          </span>
        )}
        <span className="text-ink-soft text-label tracking-[0.24em] uppercase opacity-70">
          Showroom assistant
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-[0.9em] p-[clamp(14px,1.6vh,58px)]">
        <Presence status={status} />
        <Clock />
      </div>
    </header>
  )
}

/**
 * Awake, listening, or asleep — as a word, not only a colour.
 *
 * A green dot alone says "on" to somebody who already knows the convention and
 * nothing to anybody else, and it is the one piece of state a visitor needs
 * before they will talk to a screen in front of strangers.
 */
function Presence({ status }: { status: string }) {
  const listening = status === 'listening'
  const busy = status === 'thinking' || status === 'speaking'
  const label = listening ? 'Listening' : busy ? 'Speaking' : 'Ready'

  return (
    <span className="flex items-center gap-[0.5em] text-label">
      <span className="relative flex size-[0.6em]">
        {listening && (
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/60" />
        )}
        <span
          className="relative size-full rounded-full"
          style={{ background: busy || listening ? '#10b981' : '#a3a3a3' }}
        />
      </span>
      <span className="text-ink-soft">{label}</span>
    </span>
  )
}

/**
 * Wall-clock time, because a cabinet stands in a mall and people check it.
 *
 * Ticks on the minute rather than the second: a digit changing once a second on
 * a two-metre panel is motion in the corner of the eye, and the whole design
 * spends its motion budget on the person.
 */
function Clock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const tick = () => setNow(new Date())
    const ms = (60 - new Date().getSeconds()) * 1000
    let interval: number
    const timeout = window.setTimeout(() => {
      tick()
      interval = window.setInterval(tick, 60_000)
    }, ms)
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(interval)
    }
  }, [])

  return (
    <span className="text-ink-soft text-label tabular-nums">
      {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
    </span>
  )
}
