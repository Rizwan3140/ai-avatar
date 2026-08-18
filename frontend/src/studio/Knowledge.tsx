import { useState } from 'react'
import { api, upload, type Document, type Principal, type Product } from './api.ts'
import { Button, Empty, FilePicker, Note, Section, useLoad } from './ui.tsx'

/**
 * Everything the avatar is allowed to know — the catalog, and the company's own
 * documents.
 *
 * These were command-line only. That was defensible while one engineer ran one
 * kiosk and indefensible the moment a showroom manager needs to correct a price
 * on a Saturday.
 *
 * Products and documents share a screen because the person uploading a file
 * generally does not know which one they are holding: a brochure with a spec
 * table in it is both, and the server decides by shape rather than by extension.
 */
export function Knowledge({ who }: { who: Principal }) {
  const products = useLoad(() => api<Product[]>('/api/studio/products'))
  const documents = useLoad(() => api<Document[]>('/api/studio/knowledge'))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [note, setNote] = useState('')

  const mayWrite = who.role !== 'viewer'

  async function act(work: () => Promise<string>) {
    setBusy(true)
    setProblem('')
    setNote('')
    try {
      setNote(await work())
      products.reload()
      documents.reload()
    } catch (failure) {
      setProblem((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const importFile = (file: File) =>
    act(async () => {
      const result = await upload<{ source: string; products: number; passages: number }>(
        '/api/studio/import',
        file,
      )
      const bits = [
        result.products ? `${result.products} products` : '',
        result.passages ? `${result.passages} passages` : '',
      ].filter(Boolean)
      return `${result.source}: ${bits.join(' and ')} indexed.`
    })

  const crawl = () =>
    act(async () => {
      const url = window.prompt('Storefront URL to read')
      if (!url?.trim()) return ''
      const result = await api<{ imported: number }>('/api/studio/products/crawl', {
        method: 'POST',
        body: { url, limit: 40 },
      })
      return result.imported
        ? `${result.imported} products read from ${url}.`
        : `Nothing found at ${url}. The crawler reads schema.org data, which not every site publishes.`
    })

  const removeProduct = (product: Product) =>
    act(async () => {
      await api(`/api/studio/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' })
      return `${product.name} removed.`
    })

  const removeDocument = (source: string) =>
    act(async () => {
      await api(`/api/studio/knowledge/${encodeURIComponent(source)}`, { method: 'DELETE' })
      return `${source} removed. The avatar can no longer quote it.`
    })

  return (
    <div className="flex flex-col gap-10">
      {problem && <Note tone="warn">{problem}</Note>}
      {note && <Note>{note}</Note>}

      <Section
        title="Catalog"
        hint="What the avatar may recommend, and the only source of a price it is allowed to say out loud."
        action={
          mayWrite && (
            <div className="flex gap-2">
              <FilePicker
                label={busy ? 'Reading…' : 'Import a file'}
                accept=".csv,.tsv,.json,.txt,.md,.docx,.pdf"
                disabled={busy}
                onPick={importFile}
                tone="primary"
              />
              <Button tone="quiet" onClick={crawl} disabled={busy}>
                Read a website
              </Button>
            </div>
          )
        }
      >
        {products.error && <Note tone="warn">{products.error}</Note>}
        {!products.data ? (
          <Empty>Loading…</Empty>
        ) : products.data.length === 0 ? (
          <Empty>
            No products. Import a CSV, a JSON export or a Word document with a table in it — column
            names are matched by meaning, so the company's own headers are fine.
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full min-w-[560px] border-collapse bg-white text-sm">
              <thead>
                <tr className="border-b border-line">
                  {['Product', 'Category', 'Price', 'Image', ''].map((head) => (
                    <th
                      key={head}
                      className="text-ink-soft px-3 py-2 text-left text-[11px] font-semibold tracking-wider uppercase"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.data.map((product) => (
                  <tr key={product.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{product.name}</div>
                      <div className="text-ink-soft max-w-md truncate text-xs">
                        {product.description}
                      </div>
                    </td>
                    <td className="text-ink-soft px-3 py-2">{product.category || '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{product.spoken_price || '—'}</td>
                    <td className="px-3 py-2">
                      {/* A catalog row with no image shows a placeholder on the
                          cabinet, and cannot be used for try-on at all. */}
                      <span className={product.image ? 'text-ink-soft' : 'text-amber-700'}>
                        {product.image ? 'yes' : 'none'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {mayWrite && (
                        <button
                          type="button"
                          onClick={() => removeProduct(product)}
                          disabled={busy}
                          className="text-ink-soft text-xs underline underline-offset-2 hover:text-amber-700"
                        >
                          remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Documents"
        hint="Policies, warranties, delivery terms — the half of showroom questions no product row answers. Passages are quoted back verbatim, so what is uploaded is what gets said."
      >
        {documents.error && <Note tone="warn">{documents.error}</Note>}
        {!documents.data ? (
          <Empty>Loading…</Empty>
        ) : documents.data.length === 0 ? (
          <Empty>
            Nothing indexed. Upload a returns policy or a brochure as PDF, Word, Markdown or plain
            text, and the avatar can answer from it instead of guessing.
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
                    onClick={() => removeDocument(doc.source)}
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

      <p className="text-ink-soft max-w-prose text-xs">
        A PDF's tables are deliberately not mined for products. Recovering columns from glyph
        positions is guesswork, and a price silently attached to the wrong product is worse than not
        importing at all — nobody checks what looked like it worked. Prose from a PDF, yes; a catalog
        from a PDF, export a CSV.
      </p>
    </div>
  )
}
