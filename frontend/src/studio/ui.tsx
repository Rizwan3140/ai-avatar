import { useEffect, useRef, useState } from 'react'

/**
 * The half-dozen pieces every studio screen needs.
 *
 * Not a component library — a component library is what this becomes if anything
 * is added here speculatively. Each of these exists because three screens were
 * about to repeat it.
 */

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium tracking-wide uppercase">{label}</span>
      {hint && <span className="text-ink-soft text-xs">{hint}</span>}
      {children}
    </label>
  )
}

export function Button({
  children,
  tone = 'primary',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'quiet' | 'danger' }) {
  const style = {
    primary: 'bg-ink text-white',
    quiet: 'border border-line hover:bg-line/40',
    danger: 'border border-amber-300 text-amber-800 hover:bg-amber-50',
  }[tone]

  return (
    <button
      type="button"
      {...rest}
      className={`rounded px-3.5 py-2 text-sm font-medium transition-opacity disabled:opacity-30 ${style} ${rest.className ?? ''}`}
    >
      {children}
    </button>
  )
}

/** A message that is not an error — "saved", "12 products imported". */
export function Note({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  if (!children) return null
  return (
    // A rule down the left edge rather than a box around the words. A full
    // border makes every notice the same shape as every card on the page, so a
    // warning and a link to Documents carry identical visual weight; the rule
    // says "read this" without drawing another container to say it in.
    <p
      role={tone === 'warn' ? 'alert' : 'status'}
      className={`border-l-2 py-1 pl-4 text-sm ${
        tone === 'warn' ? 'border-amber-500 text-amber-800' : 'border-line text-ink-soft'
      }`}
    >
      {children}
    </p>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-ink-soft py-6 text-sm">{children}</p>
}

export function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {hint && <p className="text-ink-soft max-w-prose text-xs">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * A file picker that looks like a button.
 *
 * `<input type="file">` styled directly is a fight with every browser's own
 * rendering; a hidden input driven by a real button is the boring version that
 * works everywhere.
 */
export function FilePicker({
  label,
  accept,
  onPick,
  disabled,
  tone = 'quiet',
}: {
  label: string
  accept: string
  onPick: (file: File) => void
  disabled?: boolean
  tone?: 'primary' | 'quiet'
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onPick(file)
          // Reset, so picking the same file twice fires twice — re-uploading a
          // corrected CSV under the same name is the common case.
          event.target.value = ''
        }}
      />
      <Button tone={tone} disabled={disabled} onClick={() => input.current?.click()}>
        {label}
      </Button>
    </>
  )
}

/** Load once on mount, with the three states every panel needs. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let live = true
    setError('')
    load()
      .then((value) => live && setData(value))
      .catch((problem: Error) => live && setError(problem.message))
    return () => {
      // A screen switched away from mid-request must not write into a component
      // that is no longer mounted.
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps])

  return { data, error, setData, reload: () => setNonce((n) => n + 1) }
}
