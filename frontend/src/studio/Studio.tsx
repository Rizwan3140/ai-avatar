import { useEffect, useState } from 'react'
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
  | 'seasons'

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
    // A page needs a top. This one began at a bare white edge with a heading
    // sitting on it, which is why it read as a settings screen however the type
    // was set. The band is the accent at two percent — enough that the header
    // is a place rather than the absence of one, faint enough that it never
    // competes with the work below it, and it re-tints with the season because
    // it is drawn from the same token.
    <div className="bg-canvas text-ink relative h-full overflow-y-auto">
      <div className="from-accent/[0.055] pointer-events-none absolute inset-x-0 top-0 h-[340px] bg-linear-to-b to-transparent" />
      <div className="relative mx-auto flex max-w-5xl flex-col gap-8 px-8 py-10">
        <header className="flex flex-col gap-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              {/* The same display serif the cabinet uses for a garment's name.
                  The Studio and the panel are one product; a dashboard set
                  entirely in the interface face looks like a different one. */}
              <h1 className="font-display text-[42px] leading-none capitalize">{title}</h1>
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

          {/* A rule with the current section sitting on it, rather than pills in
              a capsule. The capsule was a container drawn around four words to
              tell you they belonged together, which the row already said. */}
          <nav className="border-line flex flex-wrap gap-8 border-b">
            {TABS.map(({ id }) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`-mb-px border-b-2 pb-3 text-sm capitalize transition-colors ${
                  view === id
                    ? 'border-ink text-ink'
                    : 'text-ink-soft hover:text-ink border-transparent'
                }`}
              >
                {id}
              </button>
            ))}
          </nav>
        </header>

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

        {view === 'home' && <Home summary={summary} onView={setView} />}
        {view === 'products' && <Products who={who} onView={setView} />}
        {view === 'ads' && <Campaigns who={who} />}
        {view === 'avatars' && <Avatars who={who} />}
        {view === 'documents' && <Documents who={who} onView={setView} />}
        {view === 'kiosks' && <Kiosks who={who} />}
        {view === 'team' && <Team who={who} org={org} />}
        {view === 'insights' && <Insights />}
        {view === 'seasons' && <Seasons who={who} />}
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

  // The showroom, rather than a description of it.
  //
  // This page listed counts and section names and nothing else, and it read as
  // a text document because that is what it was — while the machine it
  // describes holds two portraits and five thousand photographs. A person who
  // opens this wants to recognise their own showroom in it, which no number
  // does. Both calls are cheap and neither blocks the page: the sections render
  // regardless, and the strip simply fills in.
  const [faces, setFaces] = useState<{ id: string; name: string; poster: string }[]>([])
  const [shots, setShots] = useState<{ id: string; name: string; image: string }[]>([])

  useEffect(() => {
    api<{ id: string; name: string; poster: string }[]>('/api/studio/avatars')
      .then((all) => setFaces(all.filter((a) => a.poster)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!faces.length) return
    // Scoped to an avatar because every catalog read is: the org is resolved
    // from who is being shown, never from a parameter the caller picks.
    fetch(`/api/products?limit=12&avatar=${encodeURIComponent(faces[0].id)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((all: { id: string; name: string; image: string }[]) =>
        setShots(all.filter((p) => p.image).slice(0, 8)),
      )
      .catch(() => {})
  }, [faces])

  return (
    <div className="flex flex-col gap-9">
      {/* What is on this machine, said out loud.
          It was four metric tiles, then a quiet grey line — a correction that
          overshot, because the line was so restrained it read as a footnote on
          a page with nothing else at the top of it. Type at this scale is the
          page: the numbers are the headline, the words around them recede, and
          each number is still the link it always was. */}
      <p className="font-display flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[clamp(30px,4.2vw,52px)] leading-[1.15]">
        {counts.map(({ label, value, view }, i) => (
          <button
            key={label}
            type="button"
            onClick={() => onView(view)}
            className="group inline-flex items-baseline gap-2"
          >
            <span className="text-accent decoration-accent/30 group-hover:decoration-accent tabular-nums underline decoration-2 underline-offset-[0.14em] transition-colors">
              {value}
            </span>
            <span className="text-ink-soft group-hover:text-ink transition-colors">
              {label.toLowerCase()}
              {i < counts.length - 1 && ','}
            </span>
          </button>
        ))}
      </p>

      {/* Who is standing in the cabinets, and what they are selling. The page
          stopped a third of the way down and had nothing on it that belonged to
          this particular showroom; these are the two things that do. */}
      {(faces.length > 0 || shots.length > 0) && (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-5">
          {faces.map((face) => (
            <button
              key={face.id}
              type="button"
              onClick={() => onView('avatars')}
              className="group flex flex-col gap-2"
              title={face.name}
            >
              <img
                src={face.poster}
                alt={face.name}
                className="border-line bg-line/20 h-28 w-24 rounded-lg border object-cover object-top transition-transform duration-500 ease-(--ease-human) group-hover:-translate-y-1"
              />
              <span className="text-ink-soft group-hover:text-ink text-xs transition-colors">
                {face.name}
              </span>
            </button>
          ))}

          {shots.length > 0 && (
            <button
              type="button"
              onClick={() => onView('products')}
              className="group flex min-w-0 flex-1 flex-col gap-2"
            >
              {/* Overlapped rather than spaced, so eight garments read as a rail
                  of clothes instead of eight more boxes in a row of boxes. */}
              <div className="flex">
                {shots.map((shot, i) => (
                  <img
                    key={shot.id}
                    src={shot.image}
                    alt=""
                    style={{ zIndex: shots.length - i }}
                    className="border-canvas bg-line/20 -ml-3 h-28 w-20 rounded-lg border-2 object-cover object-top transition-transform duration-500 ease-(--ease-human) first:ml-0 group-hover:-translate-y-1"
                  />
                ))}
              </div>
              <span className="text-ink-soft group-hover:text-ink text-left text-xs transition-colors">
                in the catalog
              </span>
            </button>
          )}
        </div>
      )}

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

      {/* Three things to do, then everywhere else to go.
          Both were grids of identically sized boxes holding a bold line over a
          grey line — the same component twice, which told a reader the two
          sections were equally important when one is the point of the page and
          the other is a directory. The boxes are gone. What is left is a list
          with hairlines between the rows, the titles in the display serif, and
          the difference in weight between the two sections carried by type
          size rather than by repeating a card at two widths. */}
      <section className="flex flex-col">
        <h2 className="text-ink-soft mb-1 text-xs tracking-[0.14em] uppercase">Start here</h2>
        {[
          { view: 'products' as View, title: 'Upload products', body: 'A CSV, a JSON export, or a Word document with a table in it.' },
          { view: 'ads' as View, title: 'Add an advertisement', body: 'Images or clips that play while nobody is talking. Press Run to watch them.' },
          { view: 'avatars' as View, title: 'Talk to an avatar', body: 'Open the showroom screen and hold a conversation with it.' },
        ].map((row) => (
          <button
            key={row.view}
            type="button"
            onClick={() => onView(row.view)}
            className="group border-line flex items-center gap-5 border-b py-6 text-left"
          >
            <div className="flex min-w-0 flex-col gap-1">
              {/* The title moves rather than the row lighting up. A background
                  tint on hover is the same weight as every other hover on the
                  page; a title that steps toward you says which one is under
                  the cursor without adding another colour to the palette. */}
              <span className="font-display text-[clamp(22px,2.6vw,34px)] leading-none transition-transform duration-300 ease-(--ease-human) group-hover:translate-x-1">
                {row.title}
              </span>
              <span className="text-ink-soft text-sm">{row.body}</span>
            </div>
            {/* The affordance the row was missing. A list of headings with no
                mark reads as prose; one arrow says every line here goes
                somewhere. */}
            <span
              aria-hidden
              className="text-ink-soft/50 group-hover:text-accent ml-auto shrink-0 text-3xl transition-[color,transform] duration-300 ease-(--ease-human) group-hover:translate-x-1"
            >
              &rarr;
            </span>
          </button>
        ))}
      </section>

      <section className="flex flex-col">
        <h2 className="text-ink-soft mb-1 text-xs tracking-[0.14em] uppercase">Everything else</h2>
        <div className="grid sm:grid-cols-2 sm:gap-x-10">
          {ELSEWHERE.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onView(item.id)}
              className="border-line hover:bg-ink/[0.025] flex items-baseline justify-between gap-4 border-b py-3.5 text-left transition-colors"
            >
              <span className="text-sm font-medium">{item.title}</span>
              <span className="text-ink-soft truncate text-xs">{item.blurb}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
