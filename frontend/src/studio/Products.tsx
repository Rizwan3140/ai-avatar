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
  const [draft, setDraft] = useState<Product | null>(null)
  const [crawlOpen, setCrawlOpen] = useState(false)
  const [crawlUrl, setCrawlUrl] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

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
      const url = crawlUrl.trim()
      if (!url) return null
      const result = await api<{ imported: number }>('/api/studio/products/crawl', {
        method: 'POST',
        body: { url, limit: 40 },
      })
      setCrawlUrl('')
      setCrawlOpen(false)
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
      const { removed } = await api<{ removed: number }>('/api/studio/products', {
        method: 'DELETE',
      })
      setConfirmClear(false)
      return { text: `${removed} removed. The catalog is empty — import yours now.` }
    })

  const remove = (product: Product) =>
    act(async () => {
      await api(`/api/studio/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' })
      return { text: `${product.name} removed.` }
    })

  const saveEdit = () =>
    act(async () => {
      if (!draft) return null
      const saved = await api<Product>('/api/studio/products', {
        method: 'PUT',
        body: draft,
      })
      setDraft(null)
      return { text: `${saved.name} saved.` }
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
            <div className="flex flex-wrap gap-2">
              <FilePicker
                label={busy ? 'Reading…' : 'Import a file'}
                accept=".csv,.tsv,.json,.txt,.md,.docx,.pdf"
                disabled={busy}
                onPick={importFile}
                tone="primary"
              />
              <Button tone="quiet" onClick={() => setCrawlOpen((value) => !value)} disabled={busy}>
                Read a website
              </Button>
              {/* Sample data is useful until the moment a customer uploads
                  their own, and then it is a laptop in a saree shop. */}
              {confirmClear ? (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1">
                  <span className="text-amber-800 text-xs">Remove {products.data?.length ?? 0} products?</span>
                  <Button tone="danger" onClick={clearAll} disabled={busy}>Yes, clear</Button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="text-amber-800 text-xs underline underline-offset-2"
                  >
                    cancel
                  </button>
                </div>
              ) : (
                <Button
                  tone="danger"
                  onClick={() => setConfirmClear(true)}
                  disabled={busy || !products.data?.length}
                >
                  Clear all
                </Button>
              )}
            </div>
          )
        }
      >
        {products.error && <Note tone="warn">{products.error}</Note>}
        {crawlOpen && (
          <form
            className="mb-5 flex flex-col gap-3 rounded-lg border border-line bg-white p-4 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault()
              void crawl()
            }}
          >
            <label className="text-ink-soft flex-1 text-xs">
              Storefront URL
              <input
                className="input mt-1"
                type="url"
                inputMode="url"
                placeholder="https://shop.example.com"
                value={crawlUrl}
                onChange={(event) => setCrawlUrl(event.target.value)}
                autoFocus
                required
              />
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || !crawlUrl.trim()}>
                {busy ? 'Reading…' : 'Read URL'}
              </Button>
              <Button tone="quiet" onClick={() => setCrawlOpen(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        )}
        {draft && (
          <section className="mb-5 rounded-lg border border-line bg-white p-4" aria-label="Edit product">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-medium">Edit product</h3>
                <p className="text-ink-soft mt-1 text-xs">Keep the price, availability, and customer-facing copy accurate.</p>
              </div>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="text-ink-soft text-xs underline underline-offset-2"
              >
                cancel
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-ink-soft text-xs">
                Name
                <input
                  className="input mt-1"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label className="text-ink-soft text-xs">
                Category
                <input
                  className="input mt-1"
                  value={draft.category}
                  onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                />
              </label>
              <label className="text-ink-soft text-xs">
                Price
                <input
                  className="input mt-1"
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.price ?? ''}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      price: event.target.value === '' ? null : Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="text-ink-soft text-xs">
                Currency
                <input
                  className="input mt-1"
                  value={draft.currency}
                  onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase() })}
                  maxLength={3}
                />
              </label>
              <label className="text-ink-soft text-xs">
                Availability
                <select
                  className="input mt-1"
                  value={draft.availability}
                  onChange={(event) => setDraft({ ...draft, availability: event.target.value })}
                >
                  <option value="in_stock">In stock</option>
                  <option value="out_of_stock">Out of stock</option>
                </select>
              </label>
              <label className="text-ink-soft text-xs sm:col-span-2">
                Description
                <textarea
                  className="input mt-1 min-h-24 resize-y"
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </label>
              <label className="text-ink-soft text-xs sm:col-span-2">
                Product URL
                <input
                  className="input mt-1"
                  type="url"
                  value={draft.url}
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                />
              </label>
              <label className="text-ink-soft text-xs sm:col-span-2">
                Image URL
                <input
                  className="input mt-1"
                  type="url"
                  value={draft.image}
                  onChange={(event) => setDraft({ ...draft, image: event.target.value })}
                />
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={saveEdit} disabled={busy || !draft.name.trim()}>
                {busy ? 'Saving…' : 'Save product'}
              </Button>
              <Button tone="quiet" onClick={() => setDraft(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </section>
        )}
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
                  {['Product', 'Category', 'Price', 'Image', 'Actions'].map((head) => (
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
                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => setDraft({ ...product })}
                            disabled={busy}
                            className="text-ink-soft text-xs underline underline-offset-2 hover:text-ink"
                          >
                            edit
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(product)}
                            disabled={busy}
                            className="text-ink-soft text-xs underline underline-offset-2 hover:text-amber-700"
                          >
                            remove
                          </button>
                        </div>
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
