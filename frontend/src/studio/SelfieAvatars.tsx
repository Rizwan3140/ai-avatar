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
 * What makes an avatar a *selfie* avatar is one clip — them lifting a phone —
 * shown for the count before the picture. Without it they simply stand as they
 * are, which works and reads as somebody who was not told a photograph was
 * being taken.
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

  const install = (avatar: Avatar, file: File) =>
    act(avatar.id, async () => {
      await upload<Avatar>(`/api/studio/avatars/${avatar.id}/clips/selfie`, file)
      return `${avatar.name} now lifts a phone for the count. The clip was cropped to 9:16 and looped.`
    })

  const remove = (avatar: Avatar) =>
    act(avatar.id, async () => {
      await api<Avatar>(`/api/studio/avatars/${avatar.id}/clips/selfie`, { method: 'DELETE' })
      return `${avatar.name}'s selfie pose was removed. They stand as they are for the count.`
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
        hint="Open an avatar's selfie screen on the cabinet that should be a photo booth. A visitor taps once, is counted in, and gets a picture of the two of them — which they can send to their phone, where it is deleted after 24 hours."
      >
        {avatars.error && <Note tone="warn">{avatars.error}</Note>}
        {!avatars.data ? (
          <Empty>Loading…</Empty>
        ) : avatars.data.length === 0 ? (
          <Empty>No avatars yet. Make one under Avatars, and it appears here.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {avatars.data.map((avatar) => {
              const posed = Boolean(avatar.clips.selfie)
              const working = busy === avatar.id
              return (
                <li
                  key={avatar.id}
                  className="flex flex-wrap items-center gap-4 rounded border border-line bg-white px-3 py-3 text-sm"
                >
                  {avatar.poster ? (
                    <img
                      src={avatar.poster}
                      alt=""
                      className="h-16 w-9 shrink-0 rounded object-cover object-top"
                    />
                  ) : (
                    <span className="bg-line/40 h-16 w-9 shrink-0 rounded" aria-hidden />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium">{avatar.name}</span>
                    <span className="text-ink-soft text-xs">
                      {working
                        ? 'Installing the clip — this takes a little while…'
                        : posed
                          ? 'Selfie pose installed: they lift a phone for the count.'
                          : 'No selfie pose. They stand as they are for the count.'}
                    </span>
                  </span>

                  {mayWrite && (
                    // `video/*`, not a list of extensions: a phone records .mov,
                    // and a list would grey it out in the file dialog.
                    <FilePicker
                      label={posed ? 'Replace the pose' : 'Add a selfie pose'}
                      accept="video/*"
                      disabled={Boolean(busy)}
                      onPick={(file) => install(avatar, file)}
                    />
                  )}
                  {mayWrite && posed && (
                    <ConfirmAction
                      label="remove"
                      prompt="Remove the selfie pose?"
                      confirmLabel="Remove"
                      disabled={Boolean(busy)}
                      onConfirm={() => remove(avatar)}
                    />
                  )}
                  <a
                    href={`/selfie?avatar=${encodeURIComponent(avatar.id)}`}
                    target="_blank"
                    rel="noopener"
                    className="rounded-lg px-3.5 py-2 text-[13.5px] font-medium text-white shadow-sm hover:brightness-110"
                    style={{ background: 'var(--s-accent)' }}
                  >
                    Open selfie screen
                  </a>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </div>
  )
}
