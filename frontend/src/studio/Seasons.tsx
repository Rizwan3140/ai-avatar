import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { Button, Empty, Note } from './ui.tsx'

/**
 * What the showroom wears, and when.
 *
 * A cabinet stands in a mall through Diwali, a wedding season and an ordinary
 * Tuesday. Until this existed the appearance lived in components, so dressing
 * the room for a festival meant a code change, a rebuild, and somebody visiting
 * the machine. A season is a date range and four values now, and cabinets pick
 * it up on their next sync.
 *
 * The palette a season may set comes from the server rather than being listed
 * here. Two copies of that list would disagree the first time one changed, and
 * the server's is the one that decides.
 */
type Season = {
  id: string
  name: string
  starts: string
  ends: string
  tokens: Record<string, string>
}

const BLANK: Season = { id: '', name: '', starts: '', ends: '', tokens: {} }

export function Seasons({ who }: { who: { role: string } | null }) {
  const [seasons, setSeasons] = useState<Season[]>([])
  const [themeable, setThemeable] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<Season | null>(null)
  const [note, setNote] = useState('')
  const mayWrite = who?.role !== 'viewer'

  const load = () =>
    api<{ seasons: Season[]; themeable: Record<string, string> }>('/api/studio/seasons')
      .then((r) => {
        setSeasons(r.seasons)
        setThemeable(r.themeable)
      })
      .catch(() => setNote('Could not load seasons.'))

  useEffect(() => {
    void load()
  }, [])

  async function save() {
    if (!draft) return
    const id = draft.id || slug(draft.name)
    if (!id) return setNote('A season needs a name.')
    try {
      await api(`/api/studio/seasons/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: { ...draft, id },
      })
      setDraft(null)
      setNote('')
      await load()
    } catch (error) {
      setNote((error as Error).message)
    }
  }

  async function remove(id: string) {
    await api(`/api/studio/seasons/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(
      () => {},
    )
    await load()
  }

  return (
    <div className="flex flex-col gap-6">
      <Note>
        A season repaints the cabinet between two dates — the accent, the rules, the
        secondary text and the face names are set in. Leave both dates blank to make one
        the everyday look. Cabinets pick it up on their next sync.
      </Note>
      {note && <Note tone="warn">{note}</Note>}

      {!seasons.length && !draft && (
        <Empty>No seasons yet, so the showroom wears the same clothes all year.</Empty>
      )}

      <div className="flex flex-col">
        {seasons.map((season) => (
          <div
            key={season.id}
            className="border-line flex items-baseline justify-between gap-4 border-b py-4"
          >
            <div className="flex flex-col gap-1">
              <span className="font-display text-[22px] leading-none">{season.name}</span>
              <span className="text-ink-soft text-xs">
                {season.starts && season.ends
                  ? `${season.starts} to ${season.ends}`
                  : 'whenever nothing else applies'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {/* The season itself, not a description of it. A palette is the one
                  thing a list of colour names cannot usefully convey. */}
              <div className="flex gap-1">
                {Object.entries(season.tokens)
                  .filter(([name]) => name.startsWith('--color'))
                  .map(([name, value]) => (
                    <span
                      key={name}
                      title={`${name}: ${value}`}
                      className="border-line size-5 rounded-full border"
                      style={{ background: value }}
                    />
                  ))}
              </div>
              {mayWrite && (
                <>
                  <button
                    type="button"
                    onClick={() => setDraft(season)}
                    className="text-ink-soft hover:text-ink text-xs underline underline-offset-2"
                  >
                    edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(season.id)}
                    className="text-ink-soft hover:text-ink text-xs underline underline-offset-2"
                  >
                    remove
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {draft ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Diwali"
                className="border-line w-full border-b bg-transparent py-1.5 text-sm outline-none focus:border-ink"
              />
            </Field>
            <Field label="From">
              <input
                type="date"
                value={draft.starts}
                onChange={(e) => setDraft({ ...draft, starts: e.target.value })}
                className="border-line w-full border-b bg-transparent py-1.5 text-sm outline-none focus:border-ink"
              />
            </Field>
            <Field label="Until">
              <input
                type="date"
                value={draft.ends}
                onChange={(e) => setDraft({ ...draft, ends: e.target.value })}
                className="border-line w-full border-b bg-transparent py-1.5 text-sm outline-none focus:border-ink"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(themeable).map(([name, kind]) => (
              <Field key={name} label={label(name)}>
                <div className="flex items-center gap-2">
                  {kind === 'color' && (
                    <input
                      type="color"
                      value={draft.tokens[name] || '#000000'}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          tokens: { ...draft.tokens, [name]: e.target.value },
                        })
                      }
                      className="border-line size-8 shrink-0 cursor-pointer rounded border bg-transparent"
                    />
                  )}
                  <input
                    value={draft.tokens[name] || ''}
                    onChange={(e) =>
                      setDraft({ ...draft, tokens: { ...draft.tokens, [name]: e.target.value } })
                    }
                    placeholder={kind === 'color' ? '#c2410c' : "'Playfair Display', serif"}
                    className="border-line w-full border-b bg-transparent py-1.5 text-sm outline-none focus:border-ink"
                  />
                </div>
              </Field>
            ))}
          </div>

          <div className="flex gap-3">
            <Button onClick={() => void save()}>Save season</Button>
            <Button tone="quiet" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        mayWrite && <Button onClick={() => setDraft({ ...BLANK })}>Add a season</Button>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink-soft text-xs tracking-[0.1em] uppercase">{label}</span>
      {children}
    </label>
  )
}

/** `--color-accent` is what the server calls it; "Accent" is what a person does. */
function label(token: string): string {
  const words = token.replace(/^--(color|font)-/, '').replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
}
