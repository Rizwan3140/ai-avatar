import { useState } from 'react'
import { api, upload, type Principal, type Product } from './api.ts'
import { importMessage, type ImportResult, type Screen } from './import.ts'
import { Button, Empty, FilePicker, Note, Section, useLoad } from './ui.tsx'

/**
 * The catalog — what the avatar may recommend, and the only source of a price it
 * is allowed to say out loud.
 *
 * Its own screen because correcting a price is the most frequent job in the
 * product, and it used to sit two levels down inside a tab called "Knowledge".
 */
export function Products({ who, onView }: { who: Principal; onView: (view: Screen) => void }) {
  const products = useLoad(() => api<Product[]>('/api/studio/products'))
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
      products.reload()
    } catch (failure) {
      setProblem((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const importFile = (file: File) =>
    act(async () => {
      const result = await upload<ImportResult>('/api/studio/import', file)
      return importMessage(result, 'products')
    })

  const crawl = () =>
    act(async () => {
      const url = window.prompt('Storefront URL to read')
      if (!url?.trim()) return null
      const result = await api<{ imported: number }>('/api/studio/products/crawl', {
        method: 'POST',
        body: { url, limit: 40 },
      })
      return {
        text: result.imported
          ? `${result.imported} products read from ${url}.`
          : // Do not blame the schema. This said the site published no structured
            // data about a storefront that published perfect JSON-LD on every
            // product page — the crawl had simply spent its page budget in the
            // menu before reaching one. Name what to try, not a cause we did not
            // verify.
            `Nothing found at ${url}. Try the address of a single product page, or a collection, rather than the home page.`,
      }
    })

  const clearAll = () =>
    act(async () => {
      const n = products.data?.length ?? 0
      if (!window.confirm(`Remove all ${n} products? Import your own afterwards.`)) return null
      const { removed } = await api<{ removed: number }>('/api/studio/products', {
        method: 'DELETE',
      })
      return { text: `${removed} removed. The catalog is empty — import yours now.` }
    })

  const remove = (product: Product) =>
    act(async () => {
      await api(`/api/studio/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' })
      return { text: `${product.name} removed.` }
    })

  return (
    <div className="flex flex-col gap-8">
      {problem && <Note tone="warn">{problem}</Note>}
      {note && (
        <Note>
          {note.text}
          {/* The destination is a control, not prose — a file that landed
              somewhere unexpected is then one click away rather than a sentence
              somebody has to notice. */}
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
        title="Catalog"
        hint="Column names are matched by meaning, so a company's own export works without editing. A file is read by its shape — rows become products, prose becomes passages."
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
              {/* Sample data is useful until the moment a customer uploads
                  their own, and then it is a laptop in a saree shop. */}
              <Button
                tone="danger"
                onClick={clearAll}
                disabled={busy || !products.data?.length}
              >
                Clear all
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
            No products yet. Import a CSV, a JSON export or a Word document with a table in it.
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
                      {/* A row with no image shows a placeholder on the cabinet,
                          and cannot be used for try-on at all. */}
                      <span className={product.image ? 'text-ink-soft' : 'text-amber-700'}>
                        {product.image ? 'yes' : 'none'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {mayWrite && (
                        <button
                          type="button"
                          onClick={() => remove(product)}
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

      <p className="text-ink-soft max-w-prose text-xs">
        A PDF's tables are deliberately not mined for products. Recovering columns from glyph
        positions is guesswork, and a price silently attached to the wrong product is worse than not
        importing at all — nobody checks what looked like it worked. Prose from a PDF, yes; a catalog
        from a PDF, export a CSV.
      </p>
    </div>
  )
}
