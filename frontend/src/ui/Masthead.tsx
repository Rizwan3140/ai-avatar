import { useEffect, useState } from 'react'
import { useStore } from '../state/store.ts'
import { SHOWCASE_WIDTH } from './Showcase.tsx'

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
  const showcase = useStore((s) => s.products.length > 0)
  const sleeping = status === 'sleeping'

  return (
    <header
      aria-hidden={sleeping}
      className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex gap-4 px-safe pt-safe transition-[opacity,right] duration-700 ease-(--ease-human) ${
        // Stacked once the products take the panel. A third of the width cannot
        // hold the wordmark and the status side by side at this type scale —
        // first the status was sliced to "Lis", then, once it held its width, it
        // was printed straight through the shop's own name. Two lines fit; one
        // line was never going to.
        showcase ? 'flex-col items-start' : 'items-start justify-between'
      }`}
      // Ends where the products begin, exactly as the prompt rail does. Running
      // the full width put "SHOWROOM ASSISTANT" and the clock underneath the
      // panel, so the shop's own name was sliced off mid-word the moment
      // anybody asked to see something.
      style={{ opacity: sleeping ? 0 : 1, right: showcase ? SHOWCASE_WIDTH : 0 }}
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

      {/* The clock goes when the products come.
          With the panel up this band is a third of its usual width, and the
          wordmark alone takes two lines of it — so the time and the presence
          were pushed against the showcase edge and sliced, leaving "Lis" where
          "Listening" should be. The time is a courtesy for somebody walking
          past an idle cabinet; presence is the one fact a person needs before
          they will talk to a screen, so that is the one that stays. */}
      <div
        className={`flex shrink-0 items-center gap-[0.9em] p-[clamp(14px,1.6vh,58px)] ${
          showcase ? 'pt-0' : ''
        }`}
      >
        <Presence status={status} />
        {!showcase && <Clock />}
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
