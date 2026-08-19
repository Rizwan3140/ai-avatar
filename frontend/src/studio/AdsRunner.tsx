import { useEffect, useState } from 'react'
import type { Campaign } from './api.ts'

/**
 * Watch the playlist the way a cabinet would play it.
 *
 * Until this existed the only way to see what a screen would actually show was
 * to stand in front of one — the Ads editor rendered a static thumbnail per
 * item, which tells you nothing about pacing or about how an image reads at
 * size.
 *
 * A fixed overlay rather than the Fullscreen API: Esc already exits browser
 * fullscreen, so the two would fight over the same key, and keeping React in
 * step would mean listening for `fullscreenchange` as well. F11 is still there
 * for anyone who wants the chrome gone too.
 */
export function AdsRunner({ items, onClose }: { items: Campaign[]; onClose: () => void }) {
  const [index, setIndex] = useState(0)

  // Bound to the window, not to the overlay, so nothing has to hold focus and
  // there is no focus trap to write.
  //
  // No scroll lock: `index.css` already pins `body { overflow: hidden }` for the
  // kiosk, and the overlay is fixed and opaque over the whole viewport. Setting
  // it again would be a line that looks like it does something.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The kiosk declines to advance below two items because arming a timer for a
  // single frame is waste. That is not a reason for a preview to refuse to show
  // the one advertisement somebody just uploaded, so this displays and holds.
  const seconds = Math.max(2, items[index % items.length]?.seconds || 8)

  useEffect(() => {
    if (items.length < 2) return
    // Floor of two: the `min` attribute on the editor's number input is not
    // enforced while it is being typed into, and a draft of 1 would strobe.
    const timer = setTimeout(() => setIndex((i) => i + 1), seconds * 1000)
    return () => clearTimeout(timer)
  }, [index, items, seconds])

  if (!items.length) return null

  // Unbounded index, modulo at read: a draft edited down to a shorter list can
  // then never index past the end.
  const position = index % items.length
  const item = items[position]

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        {item.kind === 'video' ? (
          // Keyed on src: swapping only the attribute leaves the previous stream
          // decoding in some browsers. Muted because autoplay does not start
          // otherwise.
          <video
            key={item.src}
            src={item.src}
            muted
            loop
            autoPlay
            playsInline
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <img
            key={item.src}
            src={item.src}
            alt={item.id}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>

      {item.invitation && (
        <p className="px-8 pb-4 text-center text-lg text-balance text-white/90">
          {item.invitation}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/15 px-6 py-3 font-mono text-[11px] tracking-wide text-white/55 uppercase">
        <span className="flex gap-1.5">
          {items.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 rounded-full ${i === position ? 'bg-white' : 'bg-white/30'}`}
            />
          ))}
        </span>
        <span className="tabular-nums">
          {position + 1} / {items.length}
        </span>
        <span className="truncate normal-case">{item.id}</span>
        <span className="tabular-nums">{seconds}s</span>
        {items.length < 2 && <span>single — holds</span>}
        {/* Esc is unreachable on a touch panel, so the button is not a duplicate. */}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded border border-white/25 px-3 py-1 tracking-wide text-white/80 uppercase hover:bg-white/10"
        >
          Esc — close
        </button>
      </div>
    </div>
  )
}
