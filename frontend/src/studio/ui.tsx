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
      <span className="text-[12.5px] font-medium" style={{ color: 'var(--s-muted)' }}>{label}</span>
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
    primary: 'text-white shadow-sm hover:brightness-110',
    quiet: 'hover:bg-[var(--s-accent-wash)]',
    danger: 'hover:bg-amber-50',
  }[tone]

  const paint = {
    primary: { background: 'var(--s-accent)' },
    quiet: { border: '1px solid var(--s-line-firm)', color: 'var(--s-ink)' },
    danger: { border: '1px solid #e7c48f', color: 'var(--s-warn, #a45a06)' },
  }[tone]

  return (
    <button
      type="button"
      {...rest}
      style={{ ...paint, ...rest.style }}
      className={`rounded-lg px-3.5 py-2 text-[13.5px] font-medium transition-[filter,background-color,opacity] disabled:opacity-40 ${style} ${rest.className ?? ''}`}
    >
      {children}
    </button>
  )
}

/** Keep destructive confirmation beside the action instead of using a browser dialog. */
export function ConfirmAction({
  label,
  prompt,
  confirmLabel = 'Confirm',
  disabled,
  onConfirm,
}: {
  label: string
  prompt: string
  confirmLabel?: string
  disabled?: boolean
  onConfirm: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="text-ink-soft text-xs underline underline-offset-2 hover:text-amber-700 disabled:opacity-40"
      >
        {label}
      </button>
    )
  }

  return (
    <span role="group" aria-label={prompt} className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-amber-800 text-xs">{prompt}</span>
      <Button
        tone="danger"
        disabled={disabled}
        onClick={() => {
          setOpen(false)
          void onConfirm()
        }}
      >
        {confirmLabel}
      </Button>
      <Button tone="quiet" disabled={disabled} onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </span>
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

/**
 * A place to drop a file, beside the button rather than instead of it.
 *
 * Dropping is how somebody moves a file they are already looking at in a
 * folder; the button is how somebody who has never dragged a file does it. Both
 * end in the same `onPick`.
 *
 * Nothing is filtered here on purpose. `accept` on the picker hides everything
 * it does not list, which is how a phone's .mov became an upload that did
 * nothing at all — the file dialog greyed it out and no message was ever shown.
 * A drop carries whatever was dropped, the server judges it, and the server can
 * say why. That is the only place that knows.
 */
export function DropZone({
  label,
  hint,
  accept,
  onPick,
  disabled,
}: {
  label: string
  hint?: string
  accept: string
  onPick: (file: File) => void
  disabled?: boolean
}) {
  const [over, setOver] = useState(false)
  // Every child element fires its own dragenter/dragleave as the pointer
  // crosses it, so a boolean flickers off the moment the cursor moves over the
  // text inside. Counting depth is the fix that does not need pointer maths.
  const depth = useRef(0)

  const leave = () => {
    depth.current = Math.max(0, depth.current - 1)
    if (!depth.current) setOver(false)
  }

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault()
        if (disabled) return
        depth.current += 1
        setOver(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={leave}
      onDrop={(e) => {
        e.preventDefault()
        depth.current = 0
        setOver(false)
        if (disabled) return
        const file = e.dataTransfer.files?.[0]
        if (file) onPick(file)
      }}
      className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-5 py-7 text-center transition-colors duration-200"
      style={{
        borderColor: over ? 'var(--s-accent)' : 'var(--s-line)',
        background: over ? 'var(--s-accent-wash)' : 'transparent',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span className="text-[13.5px] font-medium">
        {over ? 'Drop it' : label}
      </span>
      {hint && (
        <span className="text-[12px]" style={{ color: 'var(--s-faint)' }}>
          {hint}
        </span>
      )}
      <FilePicker label="Choose a file" accept={accept} onPick={onPick} disabled={disabled} />
    </div>
  )
}

/**
 * A file dropped anywhere else is a file the browser opens.
 *
 * Chrome navigates away to render it, so a near miss on the drop zone throws
 * the whole studio away and shows the video full-screen — which reads as the
 * upload having gone somewhere, and loses whatever was unsaved on the screen.
 */
export function useNoStrayDrops() {
  useEffect(() => {
    const swallow = (event: DragEvent) => event.preventDefault()
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])
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
