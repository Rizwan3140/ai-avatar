import { useState } from 'react'
import { api, upload, type Principal } from './api.ts'
import { Button, ConfirmAction, Empty, FilePicker, Note, Section, useLoad } from './ui.tsx'

/** Who a visitor can be photographed with: a name and two files. */
type Character = { id: string; name: string; org_id: string; picture: string; clip: string }

type SelfieStatus = { available: boolean; share: boolean }

/**
 * Selfie — who a visitor can be photographed with, and the screen that does it.
 *
 * Nothing here is an avatar. This tab used to list the showroom's avatars and
 * hang a picture and a clip on each, which made the selfie something an avatar
 * had. It is a thing by itself: a selfie character is made here, from nothing
 * but a name, and given two files —
 *
 *   the picture — them as the phone sees them, arm out, background removed.
 *   This is who the visitor is photographed with. It is resized to the
 *   visitor's own face and stood beside them, so one picture serves someone
 *   leaning in and someone hanging back.
 *
 *   getting ready — five or six seconds of them lifting the phone, played once
 *   while the count runs.
 *
 * Each has a link that opens its selfie screen. That screen is what a cabinet
 * shows when it is a photo booth.
 */
export function SelfieAvatars({ who }: { who: Principal }) {
  const characters = useLoad(() => api<Character[]>('/api/studio/selfies'))
  const status = useLoad(() => api<SelfieStatus>('/api/selfie'))
  const [busy, setBusy] = useState('')
  const [problem, setProblem] = useState('')
  const [note, setNote] = useState('')
  const [name, setName] = useState('')

  const mayWrite = who.role !== 'viewer'

  async function act(id: string, work: () => Promise<string>) {
    setBusy(id)
    setProblem('')
    setNote('')
    try {
      setNote(await work())
      characters.reload()
    } catch (failure) {
      setProblem((failure as Error).message)
    } finally {
      setBusy('')
    }
  }

  const base = (one: Character) => `/api/studio/selfies/${one.id}`

  const create = () =>
    act('new', async () => {
      const made = await api<Character>('/api/studio/selfies', { method: 'POST', body: { name } })
      setName('')
      return `${made.name} is ready for a picture and a clip.`
    })

  const give = (one: Character, what: 'picture' | 'clip', file: File) =>
    act(`${one.id}-${what}`, async () => {
      await upload<Character>(`${base(one)}/${what}`, file)
      return what === 'picture'
        ? `That is now who a visitor is photographed with. It is resized to each visitor, so there is nothing to set.`
        : `${one.name} now gets ready for the count. The clip was cropped to 9:16 and plays once.`
    })

  const drop = (one: Character, what: 'picture' | 'clip') =>
    act(`${one.id}-${what}`, async () => {
      await api<Character>(`${base(one)}/${what}`, { method: 'DELETE' })
      return what === 'picture'
        ? `${one.name}'s picture was removed. Their selfie screen offers nothing until there is one.`
        : `${one.name}'s clip was removed. Their picture stands still for the count.`
    })

  const remove = (one: Character) =>
    act(one.id, async () => {
      await api(base(one), { method: 'DELETE' })
      return `${one.name} was removed, with their picture and clip.`
    })

  return (
    <div className="flex flex-col gap-8">
      {problem && <Note tone="warn">{problem}</Note>}
      {note && <Note>{note}</Note>}

      {status.data && !status.data.available && (
        <Note tone="warn">
          Selfies are switched off on this machine (LUXORA_SELFIE=0 in its .env). The screens
          below open, and offer nothing.
        </Note>
      )}
      {status.data?.available && !status.data.share && (
        <Note tone="warn">
          This machine has no address a phone can reach, so a selfie stays on the screen and
          "Share to my phone" is not shown. Set LUXORA_PUBLIC_URL, or start it with the tunnel.
        </Note>
      )}

      <Section
        title="Selfie"
        hint="Somebody a visitor can be photographed with. Give them a picture and a clip, then open their selfie screen on the cabinet that should be a photo booth: a visitor presses the camera, is counted in for eight seconds, and gets a picture of the two of them — which they can send to their phone, where it is deleted after 24 hours."
        action={
          mayWrite && (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (name.trim() && !busy) void create()
              }}
            >
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Their name"
                maxLength={80}
                aria-label="Name of a new selfie character"
                className="w-44 rounded-lg border border-line bg-white px-3 py-2 text-[13.5px]"
              />
              <Button type="submit" disabled={!name.trim() || Boolean(busy)}>
                Add
              </Button>
            </form>
          )
        }
      >
        {characters.error && <Note tone="warn">{characters.error}</Note>}
        {!characters.data ? (
          <Empty>Loading…</Empty>
        ) : characters.data.length === 0 ? (
          <Empty>
            Nobody yet. Add a name above, then give them a picture and a clip.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {characters.data.map((one) => (
              <li key={one.id} className="flex flex-col rounded border border-line bg-white text-sm">
                <div className="flex flex-wrap items-center gap-4 px-3 py-3">
                  {one.picture ? (
                    <img
                      src={one.picture}
                      alt=""
                      className="bg-line/30 h-16 w-12 shrink-0 rounded object-cover object-top"
                    />
                  ) : (
                    <span className="bg-line/40 h-16 w-12 shrink-0 rounded" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{one.name}</span>
                  {mayWrite && (
                    <ConfirmAction
                      label="remove"
                      prompt={`Remove ${one.name}, with their picture and clip?`}
                      confirmLabel="Remove"
                      disabled={Boolean(busy)}
                      onConfirm={() => remove(one)}
                    />
                  )}
                  <a
                    href={`/selfie?id=${encodeURIComponent(one.id)}`}
                    target="_blank"
                    rel="noopener"
                    className="rounded-lg px-3.5 py-2 text-[13.5px] font-medium text-white shadow-sm hover:brightness-110"
                    style={{ background: 'var(--s-accent)' }}
                  >
                    Open selfie screen
                  </a>
                </div>

                <Slot
                  name="The picture"
                  have={Boolean(one.picture)}
                  working={busy === `${one.id}-picture`}
                  present="Installed. Resized to each visitor's face and stood beside them."
                  absent="Missing — there is no selfie without it. A PNG of them as the phone sees them, background removed."
                  // PNG only, and said so: it has to arrive cut out, and the
                  // server refuses anything else with the reason.
                  accept="image/png"
                  add="Add the picture"
                  mayWrite={mayWrite}
                  disabled={Boolean(busy)}
                  onPick={(file) => give(one, 'picture', file)}
                  onRemove={() => drop(one, 'picture')}
                />
                <Slot
                  name="Getting ready"
                  have={Boolean(one.clip)}
                  working={busy === `${one.id}-clip`}
                  present="Installed. Plays once while the count runs."
                  absent="Missing — their picture stands still for the count. Five or six seconds of them lifting the phone."
                  // `video/*`, not a list of extensions: a phone records
                  // .mov, and a list would grey it out in the file dialog.
                  accept="video/*"
                  add="Add the clip"
                  mayWrite={mayWrite}
                  disabled={Boolean(busy)}
                  onPick={(file) => give(one, 'clip', file)}
                  onRemove={() => drop(one, 'clip')}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

/** One of the two things a character is given: what it is, whether it is
 *  there, and the way to put it there or take it away. */
function Slot({
  name,
  have,
  working,
  present,
  absent,
  accept,
  add,
  mayWrite,
  disabled,
  onPick,
  onRemove,
}: {
  name: string
  have: boolean
  working: boolean
  present: string
  absent: string
  accept: string
  add: string
  mayWrite: boolean
  disabled: boolean
  onPick: (file: File) => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line px-3 py-2.5">
      <span className="w-28 shrink-0 font-medium">{name}</span>
      <span className={`min-w-0 flex-1 text-xs ${have ? 'text-ink-soft' : 'text-amber-800'}`}>
        {working ? 'Installing — this takes a little while…' : have ? present : absent}
      </span>
      {mayWrite && (
        <FilePicker label={have ? 'Replace' : add} accept={accept} disabled={disabled} onPick={onPick} />
      )}
      {mayWrite && have && (
        <ConfirmAction
          label="remove"
          prompt={`Remove ${name.toLowerCase()}?`}
          confirmLabel="Remove"
          disabled={disabled}
          onConfirm={onRemove}
        />
      )}
    </div>
  )
}
