import { useEffect, useRef, useState } from 'react'
import { type View, pathForView, viewFromPath } from './routes.ts'
import { LABELS, Shell } from './Shell.tsx'
import { api, setToken, token, type Org, type Principal } from './api.ts'
import { Auth } from './Auth.tsx'
import { Avatars } from './Avatars.tsx'
import { Campaigns } from './Campaigns.tsx'
import { Insights } from './Insights.tsx'
import { Documents } from './Documents.tsx'
import { Products } from './Products.tsx'
import { Team } from './Team.tsx'
import { Note } from './ui.tsx'
import { applySeason } from '../session/season.ts'

/**
 * Avatar Studio — the shell.
 *
 * Every screen here exists because something was command-line only. Adding one
 * should require deleting one.
 *
 * The top bar carries only the four things done daily. The rest are real
 * screens reached from Home — a tab bar of eight is a menu, and a menu is what
 * you build when you have stopped deciding what matters.
 *
 * Deliberately not a mock. Everything shown here is real state, so the gaps it
 * reports — a missing clip, an unwired provider, a cabinet nobody registered —
 * are gaps in the product rather than in the page.
 */

/** What each screen is for, in one line. All nine — the tab bar only ever
 *  described the four it showed, so the other five arrived with a bare
 *  heading the moment the rail made them reachable. */
const BLURBS: Record<View, string> = {
  home: 'What is on this machine, and what to do next',
  products: 'What the avatar may recommend',
  ads: 'What plays while nobody is talking',
  avatars: 'Who stands in the cabinet',
  documents: 'Policies and brochures they can quote',
  team: 'Who else can change this',
  insights: 'What visitors asked for, and could not find',
}


/** One avatar as the dashboard needs it: enough to show and to judge. */
type Member = { id: string; name: string; poster: string; ready: boolean; missing_clips: string[] }

type Summary = {
  avatars: number
  kiosks: number
  cast: Member[]
  products: number
  documents: { source: string }[]
  incomplete: string[]
  mirrors: string
}

export default function Studio() {
  const [who, setWho] = useState<Principal | null>(null)
  const [org, setOrg] = useState<Org | null>(null)
  const [open, setOpen] = useState<boolean | null>(null)
  // The URL is the tab, so a bookmark reopens what you bookmarked and Back
  // steps between tabs instead of leaving the studio.
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname))
  const [summary, setSummary] = useState<Summary | null>(null)

  /** Change tab and say so in the address bar. */
  const go = (next: View) => {
    setView(next)
    const path = pathForView(next)
    if (window.location.pathname !== path) window.history.pushState(null, '', path)
  }

  // Back and Forward move between tabs. Without this the browser changes the
  // address and the screen stays where it was, which is worse than not having
  // the URLs at all.
  useEffect(() => {
    const pop = () => setView(viewFromPath(window.location.pathname))
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])

  // Resolve the session before drawing anything. Rendering the studio and then
  // snapping to a login is worse than a moment of nothing.
  useEffect(() => {
    let live = true
    api<{ open: boolean }>('/api/auth/status')
      .then(async ({ open: isOpen }) => {
        if (!live) return
        setOpen(isOpen)
        // An open machine has no accounts; the API hands back a local owner.
        // A closed one needs a token that has not expired.
        if (isOpen || token()) {
          const me = await api<Principal & { org: Org | null }>('/api/auth/me')
          if (!live) return
          setWho(me)
          setOrg(me.org)
        }
      })
      .catch(() => live && setOpen(true))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!who) return
    // The whole response, not just `mirrors`: Home's counts then cost no extra
    // request.
    api<Summary>('/api/studio/summary')
      .then(setSummary)
      .catch(() => setSummary(null))

    // And what the showroom is wearing, which the Studio was not asking for.
    //
    // `applySeason` is called from the kiosk's boot, and `main.tsx` deliberately
    // never boots that here — so a season repainted the cabinet and left the
    // dashboard in last year's colours. The Studio is where seasons are edited;
    // it is the one screen that must show what it is doing.
    api<{ active: Record<string, string> }>('/api/studio/seasons')
      .then((r) => applySeason(r.active))
      .catch(() => {})
  }, [who])

  if (open === null) return null
  if (!who) {
    return (
      <Auth
        open={open}
        onSignedIn={(signedIn) => {
          setWho(signedIn)
          setOpen(false)
          api<Principal & { org: Org | null }>('/api/auth/me')
            .then((me) => setOrg(me.org))
            .catch(() => {})
        }}
      />
    )
  }

  return (
    // The kiosk owns its overflow rules on `.kiosk-root`; the Studio is allowed
    // to use document scrolling so long forms and product tables remain usable.
    // The rail replaced a row of four tabs with five more screens buried behind
    // cards on Home — over half the product was reachable only by going Home
    // first and knowing which card to look under.
    <Shell view={view} onView={go} org={org?.name} who={who.email || who.role}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-[34px] leading-none tracking-[-0.01em]">{LABELS[view]}</h1>
            <p className="text-[13.5px]" style={{ color: 'var(--s-muted)' }}>
              {BLURBS[view]}
            </p>
          </div>
          {!open && (
            <button
              type="button"
              onClick={() => {
                setToken('')
                setWho(null)
              }}
              className="text-[13px] underline underline-offset-2"
              style={{ color: 'var(--s-muted)' }}
            >
              Sign out
            </button>
          )}
        </div>

        {open && (
          <p role="alert" className="border-l-2 border-amber-500 py-1 pl-4 text-sm text-amber-800">
            This machine has no accounts, so anyone who can reach it can change everything on it.
            Fine on a bench; not fine on a showroom network.{' '}
            <button
              type="button"
              onClick={() => setWho(null)}
              className="underline underline-offset-2"
            >
              Create the first account
            </button>{' '}
            — whatever is already here moves across with it.
          </p>
        )}

        {summary?.mirrors && (
          <Note tone="warn">
            This kiosk mirrors {summary.mirrors}. Changes made here are overwritten at the next sync — edit
            on the platform instead.
          </Note>
        )}

        {view === 'home' && <Home summary={summary} onView={go} />}
        {view === 'products' && <Products who={who} onView={go} />}
        {view === 'ads' && <Campaigns who={who} />}
        {view === 'avatars' && <Avatars who={who} />}
        {view === 'documents' && <Documents who={who} onView={go} />}
        {view === 'team' && <Team who={who} org={org} />}
        {view === 'insights' && <Insights />}
      </div>
    </Shell>
  )
}

/**
 * The landing page.
 *
 * The Studio used to open on the persona editor for an avatar nobody had
 * chosen, which answers a question the visitor had not asked. This answers the
 * one they did: what is on this machine, and what is missing from it.
 *
 * Counts come from the summary the shell already fetches, so this costs no
 * request of its own.
 */
function Home({
  summary,
  onView,
}: {
  summary: Summary | null
  onView: (view: View) => void
}) {
  // The cabinet this dashboard is actually driving.
  //
  // It used to open on three counts in three boxes, which is what every admin
  // panel opens on — and nothing about it said this one controls a two-metre
  // display with a person standing in it. A showroom manager knows their
  // cabinet by looking at it, so the screen leads with the thing rather than
  // with a number describing the thing.
  // It rides in on the summary rather than a fetch of its own: that route
  // exists precisely so this screen paints in one call.
  const cast = summary?.cast ?? []

  // A ledger, not a row of cards. These are four facts about one machine and
  // they are read together; three bordered boxes made them look like three
  // separate dashboards that happened to be adjacent.
  // `view: null` is a fact with nowhere to go, and it renders as a row rather
  // than a button. Cabinets is one: the screen for it exists and works, but it
  // was deliberately taken off the rail (see routes.ts), so there is no
  // destination — and pointing the row at Avatars, which is what it did, is a
  // link that says one thing and does another.
  const counts: { label: string; value: number | string; view: View | null; note: string }[] = [
    { label: 'Products', value: summary?.products ?? '-', view: 'products', note: 'they may recommend' },
    { label: 'Avatars', value: summary?.avatars ?? '-', view: 'avatars', note: 'stand in a cabinet' },
    { label: 'Cabinets', value: summary?.kiosks ?? '-', view: null, note: 'registered to this org' },
    { label: 'Documents', value: summary?.documents?.length ?? '-', view: 'documents', note: 'they can quote' },
  ]

  const start: { view: View; title: string; body: string }[] = [
    { view: 'products', title: 'Upload products', body: 'A CSV, a JSON export, or a Word document with a table in it.' },
    { view: 'ads', title: 'Add an advertisement', body: 'Images or clips that play while nobody is talking.' },
    { view: 'avatars', title: 'Talk to an avatar', body: 'Open the showroom screen and hold a conversation with it.' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* The one thing worth interrupting for. An avatar with missing footage
          does not change when spoken to, which reads as broken rather than as
          unfinished. */}
      {summary?.incomplete?.length ? (
        <Note tone="warn">
          {summary.incomplete.length === 1
            ? `${summary.incomplete[0]} is missing footage`
            : `${summary.incomplete.length} avatars are missing footage`}{' '}
          - they fall back to the idle clip, so they do not change when spoken to.
        </Note>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,290px)_1fr]">
        <Stage cast={cast} onView={onView} />

        <div className="flex flex-col gap-6">
          <section className="s-card px-5 py-1">
            {counts.map(({ label, value, view, note }) => {
              const row = (
                <>
                  <span className="font-display nums w-[2.4em] shrink-0 text-[30px] leading-none tracking-[-0.01em]">
                    {value}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[14px] font-medium">{label}</span>
                    <span className="text-[12.5px]" style={{ color: 'var(--s-faint)' }}>
                      {note}
                    </span>
                  </span>
                  {view && <Arrow />}
                </>
              )
              const shared = 'group flex w-full items-baseline gap-4 border-t py-3.5 text-left first:border-t-0'
              // A row with nowhere to go is a row, not a button. Rendering it as
              // one would give it a hover state and a pointer for a click that
              // does nothing, which is how an interface teaches people to stop
              // trusting it.
              return view ? (
                <button
                  key={label}
                  type="button"
                  onClick={() => onView(view)}
                  className={shared}
                  style={{ borderColor: 'var(--s-line)' }}
                >
                  {row}
                </button>
              ) : (
                <div key={label} className={shared} style={{ borderColor: 'var(--s-line)' }}>
                  {row}
                </div>
              )
            })}
          </section>

          <section className="s-card flex flex-col p-5">
            <h2 className="font-display text-[20px] leading-none">Start here</h2>
            <p className="mb-1 text-[13px]" style={{ color: 'var(--s-muted)' }}>
              The three things a new cabinet needs, in the order it needs them.
            </p>
            {start.map((row) => (
              <button
                key={row.view}
                type="button"
                onClick={() => onView(row.view)}
                className="group flex items-center gap-4 border-t py-3.5 text-left first:border-t-0"
                style={{ borderColor: 'var(--s-line)' }}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[14.5px] font-medium">{row.title}</span>
                  <span className="text-[13px]" style={{ color: 'var(--s-muted)' }}>
                    {row.body}
                  </span>
                </span>
                <Arrow />
              </button>
            ))}
          </section>
        </div>
      </div>
    </div>
  )
}

/**
 * The same mark on every row that leads somewhere, so "this opens something" is
 * one shape rather than three copies of one.
 *
 * It also replaced a card headed "Everything else" whose own subtitle read
 * "Also in the rail on the left" — a panel of links admitting in its subtitle
 * that it duplicated the navigation beside it. Deleting it is most of the
 * improvement, and the rail it pointed at is unchanged.
 */
/**
 * Everyone who can stand in the cabinet, one at a time, at the panel's own
 * proportions — 2160x3840, so 9:16 portrait. A landscape thumbnail of a
 * portrait display is a picture of something that does not exist.
 *
 * This showed only `default_avatar`, so a shop with three of them saw one and
 * had to leave the dashboard to find out anything about the other two — and the
 * hidden ones are exactly where missing footage hides. The default still leads,
 * because that is who a cabinet shows when nothing is assigned to it.
 *
 * The rail is a native scroll container with scroll-snap: trackpad, touch,
 * shift-wheel and keyboard all work without a line of code, and the arrows are
 * `scrollBy` over the same mechanism rather than a second source of truth. The
 * index is read back from scroll position for the same reason — a carousel that
 * keeps its own idea of which slide is showing is a carousel that disagrees with
 * itself the first time somebody swipes.
 */
function Stage({ cast, onView }: { cast: Member[]; onView: (view: View) => void }) {
  const rail = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState(0)

  const showing = cast[Math.min(at, cast.length - 1)]
  const step = (by: number) => {
    const el = rail.current
    if (el) el.scrollBy({ left: by * el.clientWidth, behavior: 'smooth' })
  }

  if (!cast.length) {
    return (
      <section className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => onView('avatars')}
          className="s-card grid aspect-[9/16] w-full place-items-center p-0 text-[13px]"
          style={{ color: 'var(--s-faint)' }}
        >
          No avatar yet
        </button>
        <p className="text-[12.5px]" style={{ color: 'var(--s-faint)' }}>
          A cabinet needs somebody to stand in it.
        </p>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="group relative">
        <div
          ref={rail}
          // `scrollLeft` divided by the slide width, rounded — which is the
          // index the snap has settled on, and stays right when the container
          // is resized.
          onScroll={(e) => {
            const el = e.currentTarget
            setAt(Math.round(el.scrollLeft / el.clientWidth))
          }}
          className="s-card flex aspect-[9/16] w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {cast.map((member) => (
            /* A link, not a click handler: the middle-click and the new tab
               come free, and this is the same address the Avatars screen
               opens. Deliberately live for an avatar with no poster — it
               falls back to the placeholder and still talks. */
            <a
              key={member.id}
              href={`/?avatar=${encodeURIComponent(member.id)}`}
              target="_blank"
              rel="noopener"
              aria-label={`Open the showroom screen as ${member.name}`}
              className="relative w-full shrink-0 snap-start overflow-hidden"
            >
              {member.poster ? (
                <img
                  src={member.poster}
                  alt=""
                  className="h-full w-full object-cover object-top transition-transform duration-700 ease-(--ease-human) group-hover:scale-[1.03]"
                />
              ) : (
                <span
                  className="grid h-full w-full place-items-center text-[13px]"
                  style={{ color: 'var(--s-faint)' }}
                >
                  No footage yet
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-linear-to-t from-black/70 to-transparent p-3 pt-10 text-white">
                <span className="font-display text-[17px] leading-none">{member.name}</span>
                <span className="text-[11.5px] opacity-80">
                  {member.ready ? 'Ready' : `${member.missing_clips.length} clips missing`}
                </span>
              </span>
            </a>
          ))}
        </div>

        {/* Only worth drawing when there is somewhere to go. They appear on
            hover and on keyboard focus — `focus-within` rather than hover
            alone, or they are unreachable without a mouse. */}
        {cast.length > 1 && (
          <>
            <Nudge side="left" disabled={at === 0} onClick={() => step(-1)} />
            <Nudge side="right" disabled={at >= cast.length - 1} onClick={() => step(1)} />
          </>
        )}
      </div>

      {cast.length > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {cast.map((member, i) => (
            <button
              key={member.id}
              type="button"
              aria-label={member.name}
              aria-current={i === at ? 'true' : undefined}
              onClick={() => {
                const el = rail.current
                if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
              }}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                width: i === at ? 18 : 6,
                background: i === at ? 'var(--s-accent)' : 'var(--s-line)',
              }}
            />
          ))}
        </div>
      )}

      <p className="text-[12.5px]" style={{ color: 'var(--s-faint)' }}>
        {at === 0 ? 'What the cabinet shows at rest. ' : ''}
        {showing ? `Opens the showroom screen as ${showing.name}.` : ''}
      </p>
    </section>
  )
}

function Nudge({
  side,
  disabled,
  onClick,
}: {
  side: 'left' | 'right'
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? 'Previous avatar' : 'Next avatar'}
      className={`absolute top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 opacity-0 shadow-md backdrop-blur transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 disabled:!opacity-0 ${
        side === 'left' ? 'left-2' : 'right-2'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="size-4"
      >
        <path d={side === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
      </svg>
    </button>
  )
}

function Arrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="ml-auto size-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1"
      style={{ color: 'var(--s-faint)' }}
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}
