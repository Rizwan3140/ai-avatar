import { useState } from 'react'
import { api, upload, type Avatar, type Campaign, type Principal } from './api.ts'
import { AdsRunner } from './AdsRunner.tsx'
import { Button, Empty, FilePicker, Note, Section, useLoad } from './ui.tsx'

/**
 * What plays while nobody is talking.
 *
 * A showroom kiosk is idle most of its life, and idle used to mean a man
 * standing still on the most expensive screen in the room. Campaigns fill that,
 * and the invitation line is the thing an ordinary advertising screen cannot do —
 * he can look up and ask a passer-by in.
 *
 * Windows crossing midnight are handled server-side: 21:00–06:00 is the evening
 * promotion, and it is the case a naive start-to-end comparison silently drops.
 */
export function Campaigns({ who }: { who: Principal }) {
  const avatars = useLoad(() => api<Avatar[]>('/api/studio/avatars'))
  const [selected, setSelected] = useState('')
  const avatarId = selected || avatars.data?.[0]?.id || ''

  const campaigns = useLoad(
    () => (avatarId ? api<Campaign[]>(`/api/studio/campaigns/${avatarId}`) : Promise.resolve([])),
    [avatarId],
  )

  const [draft, setDraft] = useState<Campaign[] | null>(null)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [note, setNote] = useState('')

  const mayWrite = who.role !== 'viewer'
  const items = draft ?? campaigns.data ?? []

  function edit(index: number, patch: Partial<Campaign>) {
    setDraft(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  async function act(work: () => Promise<string>) {
    setBusy(true)
    setProblem('')
    setNote('')
    try {
      setNote(await work())
    } catch (failure) {
      setProblem((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    act(async () => {
      await api(`/api/studio/campaigns/${avatarId}`, { method: 'PUT', body: items })
      setDraft(null)
      campaigns.reload()
      return 'Schedule saved. Cabinets pick it up without a reload.'
    })

  const addMedia = (file: File) =>
    act(async () => {
      const { src } = await upload<{ src: string }>(
        `/api/studio/campaigns/${avatarId}/media`,
        file,
      )
      const kind = /\.(mp4|webm)$/i.test(src) ? 'video' : 'image'
      setDraft([
        ...items,
        {
          id: file.name.replace(/\.[^.]+$/, ''),
          src,
          kind,
          invitation: '',
          starts: '',
          ends: '',
          seconds: 8,
        },
      ])
      return `${file.name} uploaded. It plays once you save.`
    })

  if (avatars.error) return <Note tone="warn">{avatars.error}</Note>
  if (!avatars.data) return <Empty>Loading…</Empty>
  if (avatars.data.length === 0) return <Empty>Create an avatar first.</Empty>

  return (
    <div className="flex flex-col gap-8">
      {problem && <Note tone="warn">{problem}</Note>}
      {note && <Note>{note}</Note>}

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium" style={{ color: 'var(--s-muted)' }}>Avatar</span>
        <select
          className="input max-w-xs"
          value={avatarId}
          onChange={(event) => {
            setSelected(event.target.value)
            setDraft(null)
          }}
        >
          {avatars.data.map((avatar) => (
            <option key={avatar.id} value={avatar.id}>
              {avatar.name}
            </option>
          ))}
        </select>
      </label>

      <Section
        title="Idle campaigns"
        hint="Leave both times blank to play all day. A window like 21:00 to 06:00 crosses midnight and is handled."
        action={
          <div className="flex gap-2">
            {/* Previews the draft, not the saved list — showing saved content
                while the screen displays unsaved edits is the surprising one. */}
            <Button tone="quiet" onClick={() => setRunning(true)} disabled={!items.length}>
              Run
            </Button>
            {mayWrite && (
              <FilePicker
                label={busy ? 'Uploading…' : 'Add media'}
                accept="image/*,video/mp4,video/webm"
                disabled={busy || !avatarId}
                onPick={addMedia}
                tone="primary"
              />
            )}
          </div>
        }
      >
        {campaigns.error && <Note tone="warn">{campaigns.error}</Note>}
        {items.length === 0 ? (
          <Empty>
            Nothing scheduled. Until something is, the screen shows him standing there — which is
            the whole reason this exists.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item, index) => (
              <li
                key={`${item.id}-${index}`}
                className="s-card grid gap-4 p-4 sm:grid-cols-[132px_1fr]"
              >
                <Preview item={item} />

                <div className="flex flex-col gap-3">
                  <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr_1fr_0.7fr]">
                    <Small label="Name">
                      <input
                        className="input"
                        disabled={!mayWrite}
                        value={item.id}
                        onChange={(event) => edit(index, { id: event.target.value })}
                      />
                    </Small>
                    <Small label="From">
                      <input
                        className="input"
                        type="time"
                        disabled={!mayWrite}
                        value={item.starts}
                        onChange={(event) => edit(index, { starts: event.target.value })}
                      />
                    </Small>
                    <Small label="Until">
                      <input
                        className="input"
                        type="time"
                        disabled={!mayWrite}
                        value={item.ends}
                        onChange={(event) => edit(index, { ends: event.target.value })}
                      />
                    </Small>
                    <Small label="Seconds">
                      <input
                        className="input"
                        type="number"
                        min={2}
                        max={120}
                        disabled={!mayWrite}
                        value={item.seconds}
                        onChange={(event) =>
                          edit(index, { seconds: Number(event.target.value) || 8 })
                        }
                      />
                    </Small>
                  </div>

                  <Small label="Invitation — spoken when someone walks up while this is playing">
                    <input
                      className="input"
                      disabled={!mayWrite}
                      value={item.invitation}
                      placeholder="Our winter range just arrived — would you like to see it?"
                      onChange={(event) => edit(index, { invitation: event.target.value })}
                    />
                  </Small>

                  {mayWrite && (
                    <button
                      type="button"
                      onClick={() => setDraft(items.filter((_, i) => i !== index))}
                      className="self-start text-[12.5px] underline underline-offset-2 hover:opacity-70" style={{ color: 'var(--s-muted)' }}
                    >
                      remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {mayWrite && (
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={busy || draft === null}>
              {busy ? 'Saving…' : 'Save schedule'}
            </Button>
            {draft !== null && !busy && (
              <span className="text-ink-soft text-xs">unsaved changes</span>
            )}
          </div>
        )}
      </Section>

      {running && <AdsRunner items={items} onClose={() => setRunning(false)} />}
    </div>
  )
}

function Preview({ item }: { item: Campaign }) {
  if (item.kind === 'video') {
    return (
      // Muted and loops: this is a thumbnail, not playback. A campaign editor
      // that starts talking over the person using it is its own bug report.
      <video
        src={item.src}
        muted
        loop
        playsInline
        className="aspect-[3/4] w-full rounded-[10px] object-cover" style={{ background: 'var(--s-accent-wash)' }}
      />
    )
  }
  return <img src={item.src} alt="" className="aspect-[3/4] w-full rounded-[10px] object-cover" style={{ background: 'var(--s-accent-wash)' }} />
}

function Small({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium" style={{ color: 'var(--s-muted)' }}>{label}</span>
      {children}
    </label>
  )
}
