import { useState } from 'react'
import { api, upload, type Avatar, type Principal } from './api.ts'
import { ConfirmAction, Empty, FilePicker, Note, Section, useLoad } from './ui.tsx'

type SelfieStatus = { available: boolean; share: boolean }

/**
 * Selfie avatars — who a visitor can be photographed with, and the screen that
 * does it.
 *
 * The selfie is its own screen, not something the showroom avatar offers, so
 * this is where it is reached from: each avatar has a link that opens it
 * pointed at them, the same way "talk to this avatar" opens the showroom.
 *
 * Two things make an avatar a *selfie* avatar, and both are given here:
 *
 *   the picture — them as the phone sees them, arm out, background removed.
 *   This is who the visitor is photographed with. It is resized to the
 *   visitor's own face and stood beside them, so one picture serves someone
 *   leaning in and someone hanging back.
 *
 *   getting ready — five or six seconds of them lifting the phone, played once
 *   while the count runs.
 *
 * With neither, a frame of their footage stands in and they do not move: it
 * works, and it reads as somebody who was not told a photograph was being
 * taken.
 */
export function SelfieAvatars({ who }: { who: Principal }) {
  const avatars = useLoad(() => api<Avatar[]>('/api/studio/avatars'))
  const status = useLoad(() => api<SelfieStatus>('/api/selfie'))
  const [busy, setBusy] = useState('')
  const [problem, setProblem] = useState('')
  const [note, setNote] = useState('')

  const mayWrite = who.role !== 'viewer'

  async function act(id: string, work: () => Promise<string>) {
    setBusy(id)
    setProblem('')
    setNote('')
    try {
      setNote(await work())
      avatars.reload()
    } catch (failure) {
      setProblem((failure as Error).message)
    } finally {
      setBusy('')
    }
  }

  const base = (avatar: Avatar) => `/api/studio/avatars/${avatar.id}`

  const givePicture = (avatar: Avatar, file: File) =>
    act(`${avatar.id}-picture`, async () => {
      await upload<Avatar>(`${base(avatar)}/selfie-picture`, file)
      return `That is now who a visitor is photographed with. It is resized to each visitor, so there is nothing to set.`
    })

  const dropPicture = (avatar: Avatar) =>
    act(`${avatar.id}-picture`, async () => {
      await api<Avatar>(`${base(avatar)}/selfie-picture`, { method: 'DELETE' })
      return `${avatar.name}'s selfie picture was removed. A frame of their footage is used instead.`
    })

  const giveClip = (avatar: Avatar, file: File) =>
    act(`${avatar.id}-clip`, async () => {
      await upload<Avatar>(`${base(avatar)}/clips/selfie`, file)
      return `${avatar.name} now gets ready for the count. The clip was cropped to 9:16 and plays once.`
    })

  const dropClip = (avatar: Avatar) =>
    act(`${avatar.id}-clip`, async () => {
      await api<Avatar>(`${base(avatar)}/clips/selfie`, { method: 'DELETE' })
      return `${avatar.name}'s getting-ready clip was removed. They stand as they are for the count.`
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
        title="Selfie avatars"
        hint="Open an avatar's selfie screen on the cabinet that should be a photo booth. A visitor presses the camera, is counted in for eight seconds, and gets a picture of the two of them — which they can send to their phone, where it is deleted after 24 hours."
      >
        {avatars.error && <Note tone="warn">{avatars.error}</Note>}
        {!avatars.data ? (
          <Empty>Loading…</Empty>
        ) : avatars.data.length === 0 ? (
          <Empty>No avatars yet. Make one under Avatars, and it appears here.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {avatars.data.map((avatar) => {
              const picture = avatar.selfie_picture
              const clip = Boolean(avatar.clips.selfie)
              return (
                <li key={avatar.id} className="flex flex-col rounded border border-line bg-white text-sm">
                  <div className="flex flex-wrap items-center gap-4 px-3 py-3">
                    {picture || avatar.poster ? (
                      <img
                        src={picture || avatar.poster}
                        alt=""
                        className="bg-line/30 h-16 w-12 shrink-0 rounded object-cover object-top"
                      />
                    ) : (
                      <span className="bg-line/40 h-16 w-12 shrink-0 rounded" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">{avatar.name}</span>
                    <a
                      href={`/selfie?avatar=${encodeURIComponent(avatar.id)}`}
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
                    have={Boolean(picture)}
                    working={busy === `${avatar.id}-picture`}
                    present="Installed. Resized to each visitor's face and stood beside them."
                    absent="Missing — a frame of their footage is used. A PNG of them as the phone sees them, background removed."
                    // PNG only, and said so: it has to arrive cut out, and the
                    // server refuses anything else with the reason.
                    accept="image/png"
                    add="Add the picture"
                    mayWrite={mayWrite}
                    disabled={Boolean(busy)}
                    onPick={(file) => givePicture(avatar, file)}
                    onRemove={() => dropPicture(avatar)}
                  />
                  <Slot
                    name="Getting ready"
                    have={clip}
                    working={busy === `${avatar.id}-clip`}
                    present="Installed. Plays once while the count runs."
                    absent="Missing — they stand as they are for the count. Five or six seconds of them lifting the phone."
                    // `video/*`, not a list of extensions: a phone records
                    // .mov, and a list would grey it out in the file dialog.
                    accept="video/*"
                    add="Add the clip"
                    mayWrite={mayWrite}
                    disabled={Boolean(busy)}
                    onPick={(file) => giveClip(avatar, file)}
                    onRemove={() => dropClip(avatar)}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </div>
  )
}

/** One of the two things an avatar is given: what it is, whether it is there,
 *  and the way to put it there or take it away. */
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
