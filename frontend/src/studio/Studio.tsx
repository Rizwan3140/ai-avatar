import { useEffect, useState } from 'react'
import { type View, pathForView, viewFromPath } from './routes.ts'
import { LABELS, Shell } from './Shell.tsx'
import { api, setToken, token, type Org, type Principal } from './api.ts'
import { Auth } from './Auth.tsx'
import { Avatars } from './Avatars.tsx'
import { Campaigns } from './Campaigns.tsx'
import { Seasons } from './Seasons.tsx'
import { Insights } from './Insights.tsx'
import { Kiosks } from './Kiosks.tsx'
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
  documents: 'Policies and brochures he can quote',
  kiosks: 'Which screen shows whom',
  team: 'Who else can change this',
  insights: 'What visitors asked for, and could not find',
  seasons: 'How the showroom looks this month',
}


/** Listed on the dashboard as well as in the rail, with a line saying what
 *  each one is for. */
const ELSEWHERE: { id: View; title: string; blurb: string }[] = [
  { id: 'documents', title: 'Documents', blurb: 'Policies and brochures he can quote' },
  { id: 'kiosks', title: 'Cabinets', blurb: 'Which screen shows whom' },
  { id: 'team', title: 'Team', blurb: 'Who else can change this' },
  { id: 'insights', title: 'Insights', blurb: 'What visitors asked for, and could not find' },
  { id: 'seasons', title: 'Seasons', blurb: 'How the showroom looks this month' },
]

type Summary = {
  avatars: number
  kiosks: number
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
    // `h-full overflow-y-auto`, not `min-h-full`: index.css sets
    // `body { overflow: hidden }` so a kiosk cannot rubber-band, which also meant
    // the Studio could not scroll at all — a persona editor and a product table
    // The rail replaced a row of four tabs with five more screens buried behind
    // cards on Home — over half the product was reachable only by going Home
    // first and knowing which card to look under.
    <Shell view={view} onView={go} org={org?.name ?? 'This machine'} who={who.email || who.role}>
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
        {view === 'kiosks' && <Kiosks who={who} />}
        {view === 'team' && <Team who={who} org={org} />}
        {view === 'insights' && <Insights />}
        {view === 'seasons' && <Seasons who={who} />}
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
  const counts: { label: string; value: number | string; view: View; note: string }[] = [
    { label: 'Products', value: summary?.products ?? '-', view: 'products', note: 'he may recommend' },
    { label: 'Avatars', value: summary?.avatars ?? '-', view: 'avatars', note: 'stand in a cabinet' },
    { label: 'Documents', value: summary?.documents?.length ?? '-', view: 'documents', note: 'he can quote' },
    { label: 'Cabinets', value: summary?.kiosks ?? '-', view: 'kiosks', note: 'registered' },
  ]

  const start: { view: View; title: string; body: string }[] = [
    { view: 'products', title: 'Upload products', body: 'A CSV, a JSON export, or a Word document with a table in it.' },
    { view: 'ads', title: 'Add an advertisement', body: 'Images or clips that play while nobody is talking.' },
    { view: 'avatars', title: 'Talk to an avatar', body: 'Open the showroom screen and hold a conversation with it.' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* What is on this machine. Four counts, each a way in — and only counts
          this machine can actually answer for. The reference this follows also
          showed brightness, temperature and uptime; none of those are measured
          here, and drawing a dial for a number nobody reads is the interface
          telling a comfortable lie about how much it knows. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {counts.map(({ label, value, view, note }) => (
          <button
            key={label}
            type="button"
            onClick={() => onView(view)}
            className="s-card group flex flex-col gap-1 p-4 text-left transition-shadow hover:shadow-lg"
          >
            <span className="font-display nums text-[34px] leading-none tracking-[-0.01em]">
              {value}
            </span>
            <span className="text-[13px] font-medium">{label}</span>
            <span className="text-[12px]" style={{ color: 'var(--s-faint)' }}>
              {note}
            </span>
          </button>
        ))}
      </div>

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

      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
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
            </button>
          ))}
        </section>

        <section className="s-card flex flex-col p-5">
          <h2 className="font-display text-[20px] leading-none">Everything else</h2>
          <p className="mb-1 text-[13px]" style={{ color: 'var(--s-muted)' }}>
            Also in the rail on the left.
          </p>
          {ELSEWHERE.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onView(row.id)}
              className="group flex items-baseline gap-3 border-t py-2.5 text-left first:border-t-0"
              style={{ borderColor: 'var(--s-line)' }}
            >
              <span className="text-[14px] font-medium">{row.title}</span>
              <span className="ml-auto text-right text-[12.5px]" style={{ color: 'var(--s-faint)' }}>
                {row.blurb}
              </span>
            </button>
          ))}
        </section>
      </div>
    </div>
  )
}
