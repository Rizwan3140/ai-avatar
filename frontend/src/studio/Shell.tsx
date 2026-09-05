import { type View, VIEWS, pathForView } from './routes.ts'

/**
 * The studio's frame: a rail down the left, a bar across the top, work in the
 * middle.
 *
 * It replaced a row of four tabs with five more screens hidden behind cards on
 * Home. That shape hid over half the product — Documents, Cabinets, Team,
 * Insights and Seasons were reachable only by going Home first and knowing
 * which card to look under. A rail shows all nine at once and costs 96px.
 *
 * Every entry is a real link to a real address, which is what the routing work
 * bought: middle-click opens a tab, the browser draws its own hover, and the
 * address bar agrees with the screen.
 */

/**
 * One stroke weight, one grid, drawn rather than borrowed.
 *
 * No icon library: nine glyphs do not earn a dependency that would also ship to
 * cabinets, which never open this screen. Emoji were the other tempting
 * shortcut and are worse — they render as somebody else's artwork, differently
 * on every machine, and at a weight nothing else here shares.
 */
const ICONS: Record<View, React.ReactNode> = {
  home: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  products: (
    <>
      <path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5v-7Z" />
      <path d="m3 8.5 9 4.5 9-4.5M12 13v7" />
    </>
  ),
  ads: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m10 9.5 5 2.5-5 2.5v-5Z" />
    </>
  ),
  avatars: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" />
    </>
  ),
  documents: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 19c0-3.2 2.9-5 6.5-5s6.5 1.8 6.5 5" />
      <path d="M16.5 5.6a3.2 3.2 0 0 1 0 6.1M17.5 14.4c2.4.5 4 2.1 4 4.6" />
    </>
  ),
  insights: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
}

/** What each screen is called to the person using it, not in the code. */
export const LABELS: Record<View, string> = {
  home: 'Dashboard',
  products: 'Products',
  ads: 'Ads',
  avatars: 'Avatars',
  documents: 'Documents',
  team: 'Team',
  insights: 'Insights',
}

function Icon({ view }: { view: View }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-[22px]"
    >
      {ICONS[view]}
    </svg>
  )
}

export function Shell({
  view,
  onView,
  org,
  who,
  children,
}: {
  view: View
  onView: (v: View) => void
  org?: string
  who?: string
  children: React.ReactNode
}) {
  // One name on the bar, and it comes from the account rather than the source.
  // It used to be three: a mark hardcoded `L`, a wordmark hardcoded `Dhiyona`,
  // and the real org name printed a second time beside the profile — so the
  // header of a Luxora install said Luxora, Dhiyona and L at once, and renaming
  // the company changed exactly one of them. Rename the org and all of this
  // follows, because there is only one of it now.
  const brand = org?.trim() || 'Luxora'

  return (
    <div className="studio flex min-h-screen">
      <nav
        aria-label="Studio"
        className="sticky top-0 flex h-screen w-[74px] shrink-0 flex-col items-center gap-1 overflow-y-auto border-r bg-[var(--s-card)] py-4 sm:w-[92px]"
        style={{ borderColor: 'var(--s-line)' }}
      >
        {VIEWS.map((v) => {
          const active = v === view
          return (
            <a
              key={v}
              href={pathForView(v)}
              aria-current={active ? 'page' : undefined}
              onClick={(e) => {
                // Let a modified click do what the browser does — open a tab,
                // a window, save the link. Only the plain click is ours.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                e.preventDefault()
                onView(v)
              }}
              className="flex w-[62px] flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 text-[11px] font-medium transition-colors sm:w-[76px]"
              style={{
                color: active ? 'var(--s-accent-ink)' : 'var(--s-muted)',
                background: active ? 'var(--s-accent-wash)' : 'transparent',
              }}
            >
              <Icon view={v} />
              <span className="text-center leading-tight">{LABELS[v]}</span>
            </a>
          )
        })}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-[var(--s-card)] px-5 sm:px-8"
          style={{ borderColor: 'var(--s-line)' }}
        >
          {/*
            The wordmark is a way home from every screen, and it navigates the
            way the rail does rather than reloading the page. It was the one
            link in the shell without a handler, so the single most-clicked
            path back to Home was also the only one that threw the app away
            and rebuilt it — a white flash, and every open panel forgotten.
          */}
          <a
            href={pathForView('home')}
            aria-label={`${brand} — Home`}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
              e.preventDefault()
              onView('home')
            }}
            className="flex items-center gap-2.5"
          >
            <span
              className="grid size-8 place-items-center rounded-[9px] text-[15px] font-semibold text-white"
              style={{ background: 'var(--s-accent)' }}
            >
              {brand.slice(0, 1).toUpperCase()}
            </span>
            <span className="font-display text-[19px] tracking-[0.1em] uppercase">{brand}</span>
          </a>

          <div className="flex items-center gap-3 text-[13px]" style={{ color: 'var(--s-muted)' }}>
            {who && (
              <span
                className="grid size-8 place-items-center rounded-full text-[12px] font-semibold uppercase"
                style={{ background: 'var(--s-accent-wash)', color: 'var(--s-accent-ink)' }}
                title={who}
              >
                {who.slice(0, 2)}
              </span>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1180px] flex-1 px-5 py-7 sm:px-8 sm:py-9">
          {children}
        </main>
      </div>
    </div>
  )
}
