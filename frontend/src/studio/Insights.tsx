import { useEffect, useState } from 'react'
import { api } from './api.ts'

/**
 * What visitors actually did.
 *
 * The most valuable panel here is the last one — questions that matched nothing.
 * Every other number describes what the showroom already sells; that one is a
 * list of what customers asked for and walked away without.
 */
type Summary = {
  days: number
  conversations: number
  questions: number
  unanswered: number
  answered_from_documents: number
  tryons: number
  top_questions: [string, number][]
  top_products_shown: [string, number][]
  top_products_viewed: [string, number][]
  top_products_tried: [string, number][]
  gaps: [string, number][]
}

export function Insights() {
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api<Summary>('/api/analytics')
      .then((summary) => live && setData(summary))
      .catch((problem: Error) => live && setError(problem.message))
    return () => {
      live = false
    }
  }, [])

  if (error) return <p className="text-sm text-amber-700">{error}</p>
  if (!data) return <p className="text-ink-soft text-sm">Loading…</p>

  const answered = data.questions - data.unanswered
  const rate = data.questions ? Math.round((answered / data.questions) * 100) : 0

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-4">
        <Stat label="Conversations" value={data.conversations} />
        <Stat label="Questions" value={data.questions} />
        <Stat label="Answered" value={`${rate}%`} />
        <Stat
          label="Unanswered"
          value={data.unanswered}
          tone={data.unanswered > 0 ? 'warn' : undefined}
        />
      </div>

      <Panel
        title="Asked for, not stocked"
        hint="Questions that matched no product. The most actionable list here — each line is a customer who wanted something and left without it."
        rows={data.gaps}
        empty="Nothing yet. Every question so far found a product."
        tone="warn"
      />

      <div className="grid gap-8 md:grid-cols-2">
        <Panel title="Most asked" rows={data.top_questions} empty="No questions yet." />
        <Panel
          title="Most opened"
          hint="Opening a product is a stronger signal than it merely appearing in results."
          rows={data.top_products_viewed}
          empty="No products opened yet."
        />
      </div>

      {data.tryons > 0 && (
        <Panel
          title="Most tried on"
          hint="Counts only. No photograph is stored, and there is no code path that could store one."
          rows={data.top_products_tried}
          empty="Nobody has tried anything on yet."
        />
      )}

      <p className="text-ink-soft max-w-prose text-xs">
        Last {data.days} days. {data.answered_from_documents} answer
        {data.answered_from_documents === 1 ? '' : 's'} drew on an uploaded document — if that
        number is zero, the knowledge base is not earning its upload. Nothing here identifies a
        visitor: what was asked and what was shown, never who asked it.
      </p>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${tone === 'warn' ? 'text-amber-700' : ''}`}>
        {value}
      </div>
      <div className="text-ink-soft text-[11px] tracking-wider uppercase">{label}</div>
    </div>
  )
}

function Panel({
  title,
  hint,
  rows,
  empty,
  tone,
}: {
  title: string
  hint?: string
  rows: [string, number][]
  empty: string
  tone?: 'warn'
}) {
  const max = Math.max(1, ...rows.map(([, n]) => n))

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {hint && <p className="text-ink-soft max-w-prose text-xs">{hint}</p>}
      </div>

      {rows.length === 0 ? (
        <p className="text-ink-soft text-sm">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {rows.map(([label, count]) => (
            <li key={label} className="flex items-center gap-3 text-sm">
              {/* The bar carries the comparison so the eye does not have to do
                  arithmetic across the column. */}
              <span
                className={`h-5 shrink-0 rounded-sm ${tone === 'warn' ? 'bg-amber-200' : 'bg-line'}`}
                style={{ width: `${Math.max(6, (count / max) * 34)}%` }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="text-ink-soft tabular-nums">{count}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
