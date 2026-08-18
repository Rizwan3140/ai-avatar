import { useEffect, useState } from 'react'
import { api, setToken, token, type Org, type Principal } from './api.ts'
import { Auth } from './Auth.tsx'
import { Avatars } from './Avatars.tsx'
import { Campaigns } from './Campaigns.tsx'
import { Insights } from './Insights.tsx'
import { Kiosks } from './Kiosks.tsx'
import { Knowledge } from './Knowledge.tsx'
import { Team } from './Team.tsx'
import { Note } from './ui.tsx'

/**
 * Avatar Studio — the shell.
 *
 * Six screens, and every one of them exists because something was command-line
 * only. Adding a seventh should require deleting one.
 *
 * Deliberately not a mock. Everything shown here is real state, so the gaps it
 * reports — a missing clip, an unwired provider, a cabinet nobody registered —
 * are gaps in the product rather than in the page.
 */
type Tab = 'avatars' | 'knowledge' | 'campaigns' | 'kiosks' | 'team' | 'insights'

const TABS: { id: Tab; blurb: string }[] = [
  { id: 'avatars', blurb: 'Who stands in the cabinet' },
  { id: 'knowledge', blurb: 'What he is allowed to know' },
  { id: 'campaigns', blurb: 'What plays while nobody is talking' },
  { id: 'kiosks', blurb: 'Which screen shows whom' },
  { id: 'team', blurb: 'Who else can change this' },
  { id: 'insights', blurb: 'What visitors asked for, and what they could not find' },
]

export default function Studio() {
  const [who, setWho] = useState<Principal | null>(null)
  const [org, setOrg] = useState<Org | null>(null)
  const [open, setOpen] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('avatars')
  const [mirrors, setMirrors] = useState('')

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
    api<{ mirrors: string }>('/api/studio/summary')
      .then((summary) => setMirrors(summary.mirrors))
      .catch(() => setMirrors(''))
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

  const current = TABS.find((t) => t.id === tab)!

  return (
    <div className="bg-canvas text-ink min-h-full">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-8 py-10">
        <header className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight capitalize">{current.id}</h1>
              <p className="text-ink-soft text-sm">{current.blurb}</p>
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
                onClick={() => setTab(id)}
                className={`rounded-full px-4 py-1.5 text-sm capitalize transition-colors ${
                  tab === id ? 'bg-ink text-white' : 'hover:bg-line/40'
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

        {mirrors && (
          <Note tone="warn">
            This kiosk mirrors {mirrors}. Changes made here are overwritten at the next sync — edit
            on the platform instead.
          </Note>
        )}

        {tab === 'avatars' && <Avatars who={who} />}
        {tab === 'knowledge' && <Knowledge who={who} />}
        {tab === 'campaigns' && <Campaigns who={who} />}
        {tab === 'kiosks' && <Kiosks who={who} />}
        {tab === 'team' && <Team who={who} org={org} />}
        {tab === 'insights' && <Insights />}
      </div>
    </div>
  )
}
