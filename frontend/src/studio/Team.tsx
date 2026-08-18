import { useState } from 'react'
import { api, type Org, type Principal } from './api.ts'
import { Button, Empty, Field, Note, Section, useLoad } from './ui.tsx'

type Member = { id: string; email: string; role: string }

/**
 * Who else can change this, and what kind of business this is.
 *
 * Members are created rather than invited by email. A showroom team is three
 * people, not three hundred, and an email round trip buys nothing that an owner
 * handing over a password does not — while adding a mail provider, a token
 * table and a delivery failure mode.
 */
export function Team({ who, org }: { who: Principal; org: Org | null }) {
  const members = useLoad(() => api<Member[]>('/api/studio/members'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('editor')
  const [vertical, setVertical] = useState(org?.vertical ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [note, setNote] = useState('')

  const isOwner = who.role === 'owner'

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

  const add = () =>
    act(async () => {
      await api('/api/studio/members', { method: 'POST', body: { email, password, role } })
      members.reload()
      const created = email
      setEmail('')
      setPassword('')
      return `${created} added. Give them that password directly — it is not emailed.`
    })

  const remove = (member: Member) =>
    act(async () => {
      if (!window.confirm(`Remove ${member.email}?`)) return ''
      await api(`/api/studio/members/${member.id}`, { method: 'DELETE' })
      members.reload()
      return `${member.email} removed.`
    })

  const saveVertical = () =>
    act(async () => {
      await api('/api/studio/org', { method: 'PATCH', body: { vertical } })
      return 'Saved.'
    })

  const exportAll = () =>
    act(async () => {
      const data = await api<unknown>('/api/studio/export')
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = `${org?.id ?? 'luxora'}-export.json`
      link.click()
      URL.revokeObjectURL(url)
      return 'Exported.'
    })

  return (
    <div className="flex flex-col gap-10">
      {problem && <Note tone="warn">{problem}</Note>}
      {note && <Note>{note}</Note>}

      <Section
        title={org?.name ?? 'Organisation'}
        hint="Everything on this platform is scoped to this organisation — avatars, cabinets, catalog, documents and insights."
        action={
          isOwner && (
            <Button tone="quiet" onClick={exportAll} disabled={busy}>
              Export everything
            </Button>
          )
        }
      >
        <div className="grid max-w-lg gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field
            label="Vertical"
            hint="Fashion, electronics, hotel, automobile. It shapes how the catalog reads, not what code runs — the schema is the same either way."
          >
            <input
              className="input"
              disabled={!isOwner}
              value={vertical}
              onChange={(event) => setVertical(event.target.value)}
              placeholder="electronics"
            />
          </Field>
          {isOwner && (
            <Button onClick={saveVertical} disabled={busy}>
              Save
            </Button>
          )}
        </div>
      </Section>

      <Section title="People">
        {members.error && <Note tone="warn">{members.error}</Note>}
        {!members.data ? (
          <Empty>Loading…</Empty>
        ) : (
          <ul className="flex flex-col gap-1">
            {members.data.map((member) => (
              <li
                key={member.id}
                className="flex items-center gap-4 rounded border border-line bg-white px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{member.email}</span>
                <span className="text-ink-soft text-xs">{member.role}</span>
                {isOwner && member.id !== who.user_id && (
                  <button
                    type="button"
                    onClick={() => remove(member)}
                    disabled={busy}
                    className="text-ink-soft text-xs underline underline-offset-2 hover:text-amber-700"
                  >
                    remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {isOwner && (
        <Section
          title="Add someone"
          hint="An editor can change avatars, catalogs and campaigns. A viewer can read insights and nothing else."
        >
          <div className="grid max-w-2xl gap-4 sm:grid-cols-3">
            <Field label="Email">
              <input
                className="input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="Password" hint="At least ten characters.">
              <input
                className="input"
                type="text"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label="Role">
              <select
                className="input"
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
                <option value="owner">owner</option>
              </select>
            </Field>
          </div>
          <Button onClick={add} disabled={busy || !email.trim() || password.length < 10}>
            Add
          </Button>
        </Section>
      )}
    </div>
  )
}
