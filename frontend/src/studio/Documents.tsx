import { useState } from 'react'
import { api, upload, type Document, type Principal } from './api.ts'
import { importMessage, type ImportResult, type Screen } from './import.ts'
import { Empty, FilePicker, Note, Section, useLoad } from './ui.tsx'

/**
 * The company's own words — policies, warranties, delivery terms.
 *
 * The half of showroom questions no product row can answer. Passages are quoted
 * back close to verbatim, so what is uploaded here is what gets said out loud.
 */
export function Documents({ who, onView }: { who: Principal; onView: (view: Screen) => void }) {
  const documents = useLoad(() => api<Document[]>('/api/studio/knowledge'))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [note, setNote] = useState<{ text: string; screen?: Screen } | null>(null)

  const mayWrite = who.role !== 'viewer'

  async function act(work: () => Promise<{ text: string; screen?: Screen } | null>) {
    setBusy(true)
    setProblem('')
    setNote(null)
    try {
      setNote(await work())
      documents.reload()
    } catch (failure) {
      setProblem((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const importFile = (file: File) =>
    act(async () => {
      const result = await upload<ImportResult>('/api/studio/import', file)
      return importMessage(result, 'documents')
    })

  const remove = (source: string) =>
    act(async () => {
      await api(`/api/studio/knowledge/${encodeURIComponent(source)}`, { method: 'DELETE' })
      return { text: `${source} removed. The avatar can no longer quote it.` }
    })

  return (
    <div className="flex flex-col gap-8">
      {problem && <Note tone="warn">{problem}</Note>}
      {note && (
        <Note>
          {note.text}
          {note.screen && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => onView(note.screen!)}
                className="underline underline-offset-2 capitalize"
              >
                {note.screen}
              </button>
              .
            </>
          )}
        </Note>
      )}

      <Section
        title="Documents"
        hint="Upload a returns policy, a warranty or a brochure and the avatar answers from it instead of guessing. Re-uploading a file replaces it, so an edited policy does not leave the old wording behind."
        action={
          mayWrite && (
            <FilePicker
              label={busy ? 'Reading…' : 'Upload a document'}
              accept=".pdf,.docx,.md,.markdown,.txt"
              disabled={busy}
              onPick={importFile}
              tone="primary"
            />
          )
        }
      >
        {documents.error && <Note tone="warn">{documents.error}</Note>}
        {!documents.data ? (
          <Empty>Loading…</Empty>
        ) : documents.data.length === 0 ? (
          <Empty>
            Nothing indexed. Until something is here, questions about delivery, returns or warranty
            have no grounded answer.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-1">
            {documents.data.map((doc) => (
              <li
                key={doc.source}
                className="flex items-center gap-4 rounded border border-line bg-white px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{doc.source}</span>
                <span className="text-ink-soft text-xs tabular-nums">
                  {doc.passages} passages · {Math.round(doc.characters / 1000)}k chars
                </span>
                {mayWrite && (
                  <button
                    type="button"
                    onClick={() => remove(doc.source)}
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
    </div>
  )
}
