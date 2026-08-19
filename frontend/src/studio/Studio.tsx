import { useEffect, useState } from 'react'
import { api, setToken, token, type Org, type Principal } from './api.ts'
import { Auth } from './Auth.tsx'
import { Avatars } from './Avatars.tsx'
import { Campaigns } from './Campaigns.tsx'
import { Insights } from './Insights.tsx'
import { Kiosks } from './Kiosks.tsx'
import { Documents } from './Documents.tsx'
import { Products } from './Products.tsx'
import { Team } from './Team.tsx'
import { Note } from './ui.tsx'

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
type View =
  | 'home'
  | 'products'
  | 'ads'
  | 'avatars'
  | 'documents'
  | 'kiosks'
  | 'team'
  | 'insights'

const TABS: { id: View; blurb: string }[] = [
  { id: 'home', blurb: 'What is on this machine, and what to do next' },
  { id: 'products', blurb: 'What the avatar may recommend' },
  { id: 'ads', blurb: 'What plays while nobody is talking' },
  { id: 'avatars', blurb: 'Who stands in the cabinet' },
]

/** Reached from Home rather than from the tab bar. */
const ELSEWHERE: { id: View; title: string; blurb: string }[] = [
  { id: 'documents', title: 'Documents', blurb: 'Policies and brochures he can quote' },
  { id: 'kiosks', title: 'Cabinets', blurb: 'Which screen shows whom' },
  { id: 'team', title: 'Team', blurb: 'Who else can change this' },
  { id: 'insights', title: 'Insights', blurb: 'What visitors asked for, and could not find' },
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
  const [view, setView] = useState<View>('home')
  const [summary, setSummary] = useState<Summary | null>(null)

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

  // No `!`. Four of the eight views are reached from Home and are deliberately
  // absent from TABS, so this is undefined for them — and the title below has to
  // come from the view itself rather than from the tab that does not exist.
  const current = [...TABS, ...ELSEWHERE].find((t) => t.id === view)
  // "kiosks" is the route and the type; "Cabinets" is what a person calls it.
  const title = ELSEWHERE.find((e) => e.id === view)?.title ?? view

  return (
    // `h-full overflow-y-auto`, not `min-h-full`: index.css sets
    // `body { overflow: hidden }` so a kiosk cannot rubber-band, which also meant
    // the Studio could not scroll at all — a persona editor and a product table
    // are both taller than a laptop screen, and the bottom of each was simply
    // unreachable. Scrolling here rather than relaxing the body rule keeps the
    // cabinet's behaviour untouched.
    <div className="bg-canvas text-ink h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-8 py-10">
        <header className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight capitalize">{title}</h1>
              <p className="text-ink-soft text-sm">{current?.blurb}</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-ink-soft">
                {org?.name ?? 'this machine'}
                {who.email && ` · ${who.email}`}
                {` · ${who.role}`}
              </span>
              {!open && (
                <button
                  type="button"
                  onClick={() => {
                    setToken('')
                    setWho(null)
                  }}
                  className="text-ink-soft underline underline-offset-2 hover:text-ink"
                >
                  sign out
                </button>
              )}
            </div>
          </div>

          <nav className="flex flex-wrap gap-1 rounded-full border border-line p-1">
            {TABS.map(({ id }) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`rounded-full px-4 py-1.5 text-sm capitalize transition-colors ${
                  view === id ? 'bg-ink text-white' : 'hover:bg-line/40'
                }`}
              >
                {id}
              </button>
            ))}
          </nav>
        </header>

        {open && (
          <p role="alert" className="rounded border border-line bg-white px-3 py-2 text-sm text-amber-700">
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

        {view === 'home' && <Home summary={summary} onView={setView} />}
        {view === 'products' && <Products who={who} onView={setView} />}
        {view === 'ads' && <Campaigns who={who} />}
        {view === 'avatars' && <Avatars who={who} />}
        {view === 'documents' && <Documents who={who} onView={setView} />}
        {view === 'kiosks' && <Kiosks who={who} />}
        {view === 'team' && <Team who={who} org={org} />}
        {view === 'insights' && <Insights />}
      </div>
    </div>
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
  const counts: { label: string; value: number | string; view: View }[] = [
    { label: 'Products', value: summary?.products ?? '—', view: 'products' },
    { label: 'Avatars', value: summary?.avatars ?? '—', view: 'avatars' },
    { label: 'Documents', value: summary?.documents?.length ?? '—', view: 'documents' },
    { label: 'Cabinets', value: summary?.kiosks ?? '—', view: 'kiosks' },
  ]

  return (
    <div className="flex flex-col gap-9">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-4">
        {counts.map(({ label, value, view }) => (
          <button
            key={label}
            type="button"
            onClick={() => onView(view)}
            className="flex flex-col gap-1 bg-white px-4 py-4 text-left transition-colors hover:bg-line/20"
          >
            <span className="text-2xl font-semibold tabular-nums">{value}</span>
            <span className="text-ink-soft text-xs tracking-wide uppercase">{label}</span>
          </button>
        ))}
      </div>

      {/* The one thing worth interrupting for. An avatar with missing footage
          does not change when spoken to, and that reads as broken rather than
          as unfinished. */}
      {summary?.incomplete?.length ? (
        <Note tone="warn">
          {summary.incomplete.length === 1
            ? `${summary.incomplete[0]} is missing footage`
            : `${summary.incomplete.length} avatars are missing footage`}{' '}
          — they fall back to the idle clip, so they do not change when spoken to.
        </Note>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold tracking-tight">Start here</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { view: 'products' as View, title: 'Upload products', body: 'A CSV, a JSON export, or a Word document with a table in it.' },
            { view: 'ads' as View, title: 'Add an advertisement', body: 'Images or clips that play while nobody is talking. Press Run to watch them.' },
            { view: 'avatars' as View, title: 'Talk to an avatar', body: 'Open the showroom screen and hold a conversation with it.' },
          ].map((card) => (
            <button
              key={card.view}
              type="button"
              onClick={() => onView(card.view)}
              className="flex flex-col gap-1.5 rounded border border-line bg-white px-4 py-3.5 text-left transition-colors hover:border-line-strong hover:bg-line/10"
            >
              <span className="text-sm font-medium">{card.title}</span>
              <span className="text-ink-soft text-xs">{card.body}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold tracking-tight">Everything else</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {ELSEWHERE.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onView(item.id)}
              className="flex flex-col gap-1 rounded border border-line bg-white px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-line/10"
            >
              <span className="text-sm font-medium">{item.title}</span>
              <span className="text-ink-soft text-xs">{item.blurb}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
