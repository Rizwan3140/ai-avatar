import { useEffect, useState } from 'react'
import { api, upload, type Avatar, type Principal, POSES } from './api.ts'
import { Button, Empty, Field, FilePicker, Note, useLoad } from './ui.tsx'

/**
 * Avatars — list, create, configure, delete.
 *
 * The persona editor is the highest-leverage control in the whole product: a
 * good persona beats any amount of model tuning, and it is the one thing a
 * showroom manager can change without engineering.
 *
 * Everything shown is real state. The gaps it reports — a missing clip, a
 * renderer with no key — are gaps in the product rather than in the page.
 */
/**
 * What each clip has to show. Lifted from frontend/public/README.md so the
 * person commissioning the footage can read it at the moment they upload it,
 * rather than finding out afterwards that `speak` needed a moving mouth.
 */
const CLIP_HINT: Record<string, string> = {
  idle: 'Stands still and breathes, occasional blink, mouth closed. 25–40s.',
  listen: 'Attentive, slight forward lean, small understanding nod. Mouth closed. 6–10s.',
  think: 'Eyes drift up and aside, considers, returns to camera. 4–8s.',
  speak: 'Talks to camera — mouth moving, eyebrows, small head movements. 8–12s.',
}

export function Avatars({ who }: { who: Principal }) {
  const { data: avatars, setData, error, reload } = useLoad(() => api<Avatar[]>('/api/studio/avatars'))
  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState<Partial<Avatar>>({})
  const [busy, setBusy] = useState('')
  const [problem, setProblem] = useState('')
  const [note, setNote] = useState('')

  // The voices this browser has. Read once — getVoices() returns [] on the first
  // call in Chrome, which is why the event is waited for rather than assumed.
  const [installedVoices, setInstalledVoices] = useState<{ name: string }[]>([])
  useEffect(() => {
    const read = () => setInstalledVoices(speechSynthesis.getVoices().map((v) => ({ name: v.name })))
    read()
    speechSynthesis.addEventListener('voiceschanged', read)
    return () => speechSynthesis.removeEventListener('voiceschanged', read)
  }, [])

  // Whether the selected avatar has a recording of its own, which overrides the
  // stock voice entirely.
  const [voiceState, setVoiceState] = useState<{ has_reference: boolean; model_installed: boolean } | null>(null)
  useEffect(() => {
    if (!selected) return setVoiceState(null)
    fetch(`/api/voice?avatar=${encodeURIComponent(selected)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setVoiceState)
      .catch(() => setVoiceState(null))
  }, [selected, note])

  const mayWrite = who.role !== 'viewer'
  const avatar = avatars?.find((a) => a.id === selected) ?? avatars?.[0]
  const value = <K extends keyof Avatar>(key: K): Avatar[K] | undefined =>
    (draft[key] ?? avatar?.[key]) as Avatar[K] | undefined

  function replace(updated: Avatar) {
    setData((list) => (list ?? []).map((a) => (a.id === updated.id ? updated : a)))
  }

  async function act(what: string, work: () => Promise<void>) {
    setBusy(what)
    setProblem('')
    setNote('')
    try {
      await work()
    } catch (failure) {
      setProblem((failure as Error).message)
    } finally {
      setBusy('')
    }
  }

  const save = () =>
    act('save', async () => {
      if (!avatar) return
      replace(await api<Avatar>(`/api/studio/avatars/${avatar.id}`, { method: 'PATCH', body: draft }))
      setDraft({})
      setNote('Saved. A cabinet picks this up at its next sync.')
    })

  const create = () =>
    act('create', async () => {
      const name = window.prompt('Name for the new avatar')
      if (!name?.trim()) return
      const made = await api<Avatar>('/api/studio/avatars', { method: 'POST', body: { name } })
      setData((list) => [...(list ?? []), made])
      setSelected(made.id)
      setDraft({})
      setNote(`${made.name} created. Upload a photo to give them a face.`)
    })

  const remove = () =>
    act('delete', async () => {
      if (!avatar) return
      if (!window.confirm(`Delete ${avatar.name}, their footage and their campaigns?`)) return
      await api(`/api/studio/avatars/${avatar.id}`, { method: 'DELETE' })
      setSelected('')
      setDraft({})
      reload()
    })

  const photo = (file: File) =>
    act('photo', async () => {
      if (!avatar) return
      replace(await upload<Avatar>(`/api/studio/avatars/${avatar.id}/photo`, file))
      setNote('Poster rebuilt. He still needs clips before he moves.')
    })

  const voiceClip = (file: File) =>
    act('voice', async () => {
      if (!avatar) return
      await upload(`/api/studio/avatars/${avatar.id}/voice`, file)
      setNote(`${avatar.name} now speaks in that voice.`)
    })

  const clearVoice = () =>
    act('voice', async () => {
      if (!avatar) return
      await api(`/api/studio/avatars/${avatar.id}/voice`, { method: 'DELETE' })
      setNote(`${avatar.name} is back to a stock voice.`)
    })

  const clip = (pose: string, file: File) =>
    act(`clip-${pose}`, async () => {
      if (!avatar) return
      replace(await upload<Avatar>(`/api/studio/avatars/${avatar.id}/clips/${pose}`, file))
      setNote(
        `${pose} installed — cropped to 9:16, forced to true white and ping-ponged so it ` +
          `loops without a seam. Reload the kiosk to see it.`,
      )
    })

  const dropClip = (pose: string) =>
    act(`clip-${pose}`, async () => {
      if (!avatar) return
      if (!window.confirm(`Remove the ${pose} clip? It falls back to idle.`)) return
      replace(
        await api<Avatar>(`/api/studio/avatars/${avatar.id}/clips/${pose}`, { method: 'DELETE' }),
      )
      setNote(`${pose} removed. That pose falls back to idle.`)
    })

  if (error) return <Note tone="warn">{error}</Note>
  if (!avatars) return <Empty>Loading…</Empty>

  return (
    <div className="flex flex-col gap-6">
      {problem && <Note tone="warn">{problem}</Note>}
      {note && <Note>{note}</Note>}

      {avatars.length === 0 ? (
        <div className="flex flex-col items-start gap-4">
          <Empty>
            No avatars yet. Create one, then upload a photograph of the person who should stand in
            the cabinet.
          </Empty>
          {mayWrite && <Button onClick={create}>Create an avatar</Button>}
        </div>
      ) : (
        <div className="grid gap-8 md:grid-cols-[220px_1fr]">
          <nav className="flex flex-col gap-1">
            {avatars.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setSelected(a.id)
                  setDraft({})
                }}
                className={`flex items-center gap-3 rounded px-3 py-2 text-left text-sm transition-colors ${
                  a.id === avatar?.id ? 'bg-ink text-white' : 'hover:bg-line/40'
                }`}
              >
                <img
                  src={a.poster || '/poster.svg'}
                  alt=""
                  className="h-10 w-7 rounded-sm bg-white object-cover object-top"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{a.name}</span>
                  <span className={a.id === avatar?.id ? 'text-white/60' : 'text-ink-soft'}>
                    {!a.ready
                      ? 'no poster'
                      : a.missing_clips.length === 0
                        ? 'complete'
                        : `${a.missing_clips.length} clips missing`}
                  </span>
                </span>
              </button>
            ))}
            {mayWrite && (
              <Button tone="quiet" className="mt-2" onClick={create} disabled={busy === 'create'}>
                New avatar
              </Button>
            )}
          </nav>

          {avatar && (
            <div className="flex flex-col gap-6">
              <Field label="Name">
                <input
                  className="input"
                  disabled={!mayWrite}
                  value={value('name') ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </Field>

              <Field label="Greeting" hint="Shown and spoken when nobody is talking to him.">
                <textarea
                  className="input min-h-[64px]"
                  disabled={!mayWrite}
                  value={value('greeting') ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, greeting: e.target.value }))}
                />
              </Field>

              <Field
                label="Persona"
                hint="The highest-leverage setting here. A good persona beats any amount of model tuning."
              >
                <textarea
                  className="input min-h-[260px] font-mono text-[13px] leading-relaxed"
                  disabled={!mayWrite}
                  value={value('persona') ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Language">
                  <input
                    className="input"
                    disabled={!mayWrite}
                    value={value('language') ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, language: e.target.value }))}
                  />
                </Field>
                <Field
                  label="Stock voice"
                  hint="Used until a recording is uploaded below. The list is the voices installed on the machine you are looking at — a cabinet may have different ones."
                >
                  <div className="flex gap-2">
                    <select
                      className="input w-32"
                      disabled={!mayWrite}
                      value={value('gender') ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, gender: e.target.value }))}
                    >
                      <option value="">Either</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                    {/* A picker, not a blind text field. The exact-name box was
                        the only way to choose a specific voice, and a name typed
                        from memory that does not exist falls silently through to
                        whatever sorts first. */}
                    <select
                      className="input"
                      disabled={!mayWrite}
                      value={value('voice') ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, voice: e.target.value }))}
                    >
                      <option value="">Choose by gender</option>
                      {installedVoices.map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </Field>
              </div>

              <Field
                label="Renderer"
                hint="mp4 crossfades clips and has no lip-sync. The others need their key set and a provider implementation."
              >
                <select
                  className="input"
                  disabled={!mayWrite}
                  value={value('renderer') ?? 'mp4'}
                  onChange={(e) => setDraft((d) => ({ ...d, renderer: e.target.value }))}
                >
                  <option value="mp4">mp4 — crossfaded clips</option>
                  <option value="simli">simli — lip-sync</option>
                  <option value="heygen">heygen — lip-sync</option>
                  <option value="anam">anam — lip-sync</option>
                </select>
              </Field>

              <Field
                label="Appearance"
                hint="A photograph of the person who should stand in the cabinet. The background is cut out and replaced with true white — a studio grey renders as a visible rectangle on the panel and looks exactly like a CSS bug."
              >
                <div className="flex flex-wrap items-center gap-4">
                  <img
                    src={avatar.poster || '/poster.svg'}
                    alt={avatar.poster ? `Poster for ${avatar.name}` : 'No poster yet'}
                    className="h-28 w-20 rounded border border-line bg-white object-cover object-top"
                  />
                  <div className="flex flex-col gap-2">
                    {mayWrite && (
                      <FilePicker
                        label={busy === 'photo' ? 'Cutting out…' : 'Upload a photo'}
                        accept="image/*"
                        disabled={busy === 'photo'}
                        onPick={photo}
                      />
                    )}
                    <span className="text-ink-soft text-xs">
                      {avatar.ready ? 'Poster in place.' : 'No poster — the cabinet shows a placeholder.'}
                    </span>
                  </div>
                </div>

                {/* A voice of his own, cloned from a recording. Beside the
                    footage because it is the same kind of thing: content that
                    belongs to this avatar and travels with it. */}
                <Field
                  label="His own voice"
                  hint="About thirty seconds of clear speech from whoever this avatar should sound like — an MP3 off a phone is fine. It is cloned directly: there is no training step, and replacing the file replaces the voice."
                >
                  <div className="flex flex-wrap items-center gap-3">
                    {mayWrite && (
                      <FilePicker
                        label={busy === 'voice' ? 'Uploading…' : 'Upload a recording'}
                        accept="audio/*,.mp3,.wav,.m4a"
                        disabled={busy === 'voice'}
                        onPick={voiceClip}
                      />
                    )}
                    {voiceState?.has_reference && mayWrite && (
                      <Button tone="quiet" onClick={clearVoice} disabled={busy === 'voice'}>
                        Remove
                      </Button>
                    )}
                    <span className="text-ink-soft text-xs">
                      {voiceState?.has_reference
                        ? 'Speaking in his own voice.'
                        : voiceState?.model_installed === false
                          ? 'This machine has no voice model — the stock voice above is used.'
                          : 'No recording yet, so the stock voice above is used.'}
                    </span>
                  </div>
                </Field>
              </Field>

              <Field
                label="Footage"
                hint="One short clip per state. Uploads are cropped to 9:16, forced to true white and ping-ponged so they loop without a visible seam — a raw generator clip does none of that. Installed on this machine's disk; clips are tens of megabytes and never sync."
              >
                <div className="flex flex-col gap-1">
                  {POSES.map((pose) => {
                    const have = Boolean(avatar.clips[pose])
                    const working = busy === `clip-${pose}`
                    return (
                      <div
                        key={pose}
                        className="flex flex-wrap items-center gap-3 rounded border border-line bg-white px-3 py-2 text-sm"
                      >
                        <span
                          aria-hidden
                          className={`size-2 shrink-0 rounded-full ${have ? 'bg-emerald-600' : 'bg-line-strong'}`}
                        />
                        <span className="w-14 font-medium">{pose}</span>
                        <span className="text-ink-soft min-w-0 flex-1 text-xs">
                          {working
                            ? 'Conforming — ffmpeg is re-encoding, this takes a moment…'
                            : have
                              ? CLIP_HINT[pose]
                              : `Missing — falls back to idle. ${CLIP_HINT[pose]}`}
                        </span>
                        {mayWrite && (
                          <FilePicker
                            label={have ? 'Replace' : 'Upload'}
                            accept="video/mp4,video/webm,video/quicktime"
                            disabled={!!busy}
                            onPick={(file) => clip(pose, file)}
                          />
                        )}
                        {mayWrite && have && pose !== 'idle' && (
                          <button
                            type="button"
                            onClick={() => dropClip(pose)}
                            disabled={!!busy}
                            className="text-ink-soft text-xs underline underline-offset-2 hover:text-amber-700"
                          >
                            remove
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
                {avatar.missing_clips.length > 0 && (
                  <span className="text-ink-soft text-xs">
                    Missing poses fall back to idle, so he does not change when spoken to — and with
                    no <code className="bg-line/50 rounded px-1">speak</code> clip his mouth stays
                    shut while his voice comes out of the speaker, which is the loudest tell in the
                    whole product.
                  </span>
                )}
              </Field>

              <div className="flex flex-wrap items-center gap-3">
                {/* The real kiosk in a new tab, not a preview panel. A plain
                    anchor rather than window.open: no popup blocker to fight,
                    and ctrl- or middle-click work without any code.
                    Deliberately not disabled when the avatar has no poster —
                    it falls back to the placeholder and still talks, and
                    "create an avatar, then talk to it" is the path worth
                    being able to demonstrate. */}
                <a
                  href={`/?avatar=${encodeURIComponent(avatar.id)}`}
                  target="_blank"
                  rel="noopener"
                  className="bg-ink rounded px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                >
                  Talk to this avatar
                </a>
                <span className="text-ink-soft text-xs">
                  Opens the showroom screen. It will ask for your microphone.
                </span>
              </div>

              {mayWrite && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={save} disabled={!!busy || Object.keys(draft).length === 0}>
                    {busy === 'save' ? 'Saving…' : 'Save'}
                  </Button>
                  {Object.keys(draft).length > 0 && !busy && (
                    <span className="text-ink-soft text-xs">unsaved changes</span>
                  )}
                  {who.role === 'owner' && (
                    <Button tone="danger" className="ml-auto" onClick={remove} disabled={!!busy}>
                      Delete
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
