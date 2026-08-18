import { useState } from 'react'
import { api, type Avatar, type Kiosk, type Principal } from './api.ts'
import { Button, Empty, Field, Note, Section, useLoad } from './ui.tsx'

/**
 * Cabinets, and which avatar each one shows.
 *
 * This is what replaced building the avatar's name into the app. A screen is
 * re-pointed by changing a row here; the cabinet asks the API who it is at boot
 * and again on every sync, so nothing is rebuilt and nobody visits the showroom.
 */
export function Kiosks({ who }: { who: Principal }) {
  const kiosks = useLoad(() => api<Kiosk[]>('/api/studio/kiosks'))
  const avatars = useLoad(() => api<Avatar[]>('/api/studio/avatars'))
  const [id, setId] = useState('')
  const [label, setLabel] = useState('')
  const [avatarId, setAvatarId] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  const mayWrite = who.role !== 'viewer'

  async function act(work: () => Promise<void>) {
    setBusy(true)
    setProblem('')
    try {
      await work()
      kiosks.reload()
    } catch (failure) {
      setProblem((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const register = () =>
    act(async () => {
      const chosen = avatarId || avatars.data?.[0]?.id
      if (!id.trim() || !chosen) return
      await api(`/api/studio/kiosks/${encodeURIComponent(id.trim())}`, {
        method: 'PUT',
        body: { id: id.trim(), avatar_id: chosen, label },
      })
      setId('')
      setLabel('')
    })

  const assign = (kiosk: Kiosk, to: string) =>
    act(async () => {
      await api(`/api/studio/kiosks/${encodeURIComponent(kiosk.id)}`, {
        method: 'PUT',
        body: { id: kiosk.id, avatar_id: to, label: kiosk.label },
      })
    })

  const unregister = (kiosk: Kiosk) =>
    act(async () => {
      if (!window.confirm(`Unregister ${kiosk.id}? It will fall back to the default avatar.`)) return
      await api(`/api/studio/kiosks/${encodeURIComponent(kiosk.id)}`, { method: 'DELETE' })
    })

  return (
    <div className="flex flex-col gap-10">
      {problem && <Note tone="warn">{problem}</Note>}

      <Section
        title="Cabinets"
        hint="An id here must match the KIOSK_ID on the machine driving that panel. A cabinet that is not registered falls back to the default avatar rather than showing nothing — a blank showroom screen is worse than the wrong person."
      >
        {kiosks.error && <Note tone="warn">{kiosks.error}</Note>}
        {!kiosks.data ? (
          <Empty>Loading…</Empty>
        ) : kiosks.data.length === 0 ? (
          <Empty>No cabinets registered. Every screen is showing the default avatar.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {kiosks.data.map((kiosk) => (
              <li
                key={kiosk.id}
                className="flex flex-wrap items-center gap-3 rounded border border-line bg-white px-3 py-2.5 text-sm"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-mono font-medium">{kiosk.id}</span>
                  {kiosk.label && <span className="text-ink-soft text-xs">{kiosk.label}</span>}
                </span>

                <select
                  className="input w-auto"
                  disabled={!mayWrite || busy}
                  value={kiosk.avatar_id}
                  onChange={(event) => assign(kiosk, event.target.value)}
                >
                  {(avatars.data ?? []).map((avatar) => (
                    <option key={avatar.id} value={avatar.id}>
                      {avatar.name}
                    </option>
                  ))}
                </select>

                {mayWrite && (
                  <button
                    type="button"
                    onClick={() => unregister(kiosk)}
                    disabled={busy}
                    className="text-ink-soft text-xs underline underline-offset-2 hover:text-amber-700"
                  >
                    unregister
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {mayWrite && (
        <Section title="Register a cabinet">
          {avatars.data?.length === 0 ? (
            <Empty>Create an avatar first — a cabinet has to have someone to show.</Empty>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Cabinet id" hint="Lowercase, no spaces.">
                <input
                  className="input"
                  value={id}
                  onChange={(event) => setId(event.target.value)}
                  placeholder="mumbai-flagship-1"
                />
              </Field>
              <Field label="Label" hint="For people, not for the machine.">
                <input
                  className="input"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Ground floor, by the entrance"
                />
              </Field>
              <Field label="Avatar">
                <select
                  className="input"
                  value={avatarId}
                  onChange={(event) => setAvatarId(event.target.value)}
                >
                  {(avatars.data ?? []).map((avatar) => (
                    <option key={avatar.id} value={avatar.id}>
                      {avatar.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div>
                <Button onClick={register} disabled={busy || !id.trim()}>
                  Register
                </Button>
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  )
}
