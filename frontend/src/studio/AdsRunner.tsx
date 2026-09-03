import { useEffect, useRef, useState } from 'react'
import type { Campaign } from './api.ts'

/**
 * Watch the playlist the way a cabinet plays it.
 *
 * Until this existed the only way to see what a screen would show was to stand
 * in front of one — the editor rendered a static thumbnail, which tells you
 * nothing about pacing or about how an image reads at size.
 *
 * **Edge to edge, and no letterbox.** It used to sit inside padding with
 * `object-contain`, so a portrait advertisement on a landscape laptop was a
 * small picture in a large black frame — a preview of a thing that does not
 * happen, because the cabinet is a 2160x3840 panel and the artwork is cut for
 * it. `object-cover` on a full-bleed surface is what the panel actually does.
 *
 * **A video plays to its end.** A seconds field asked how long a clip is, which
 * the file already knows and the person filling in the form usually does not —
 * type 8 for a twelve second clip and the last four seconds simply never play,
 * with nothing to say why. Stills still need a duration, because a picture has
 * no end of its own.
 *
 * **Tapping moves.** Left half back, right half forward, the way stories work
 * everywhere. Invisible, because a control drawn over an advertisement is a
 * control in the photograph.
 *
 * A fixed overlay rather than the Fullscreen API: Esc already exits browser
 * fullscreen, so the two would fight over the same key.
 */

/** How long a still holds. A picture has no end of its own. */
const STILL_SECONDS = 10

/**
 * The longest any one advertisement holds the screen.
 *
 * A clip plays to its end, unless its end is a long way off. Somebody uploads a
 * three minute brand film and the playlist stops being a playlist — every other
 * advertisement waits behind it, and the visitor who walked up thirty seconds
 * in sees the middle of something with no beginning.
 */
const MAX_SECONDS = 60

export function AdsRunner({ items, onClose }: { items: Campaign[]; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const video = useRef<HTMLVideoElement | null>(null)

  const count = items.length
  // Unbounded index, modulo at read: a draft edited down to a shorter list can
  // then never index past the end. Negative indices wrap too, so going back
  // from the first item lands on the last rather than on nothing.
  const position = count ? ((index % count) + count) % count : 0
  const item = items[position]

  const go = (delta: number) => setIndex((i) => i + delta)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') go(1)
      if (event.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // A still holds for a fixed spell. A clip runs to its own end and `onEnded`
  // moves on — but a timer arms underneath it at the ceiling, so a long film
  // cannot hold the screen. Whichever comes first wins, and neither needs to
  // know about the other.
  //
  // A single item holds either way: replacing a frame with itself is waste.
  useEffect(() => {
    if (count < 2) return
    const hold = item?.kind === 'video' ? MAX_SECONDS : STILL_SECONDS
    const timer = setTimeout(() => go(1), hold * 1000)
    return () => clearTimeout(timer)
  }, [index, count, item?.kind])

  if (!count || !item) return null

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {item.kind === 'video' ? (
        // Keyed on src: swapping only the attribute leaves the previous stream
        // decoding in some browsers. Muted because autoplay does not start
        // otherwise. `loop` is gone — a looping clip can never reach `onEnded`,
        // so the playlist would stop on the first video and never move again.
        <video
          key={item.src}
          ref={video}
          src={item.src}
          muted
          autoPlay
          playsInline
          onEnded={() => count > 1 && go(1)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <img
          key={item.src}
          src={item.src}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
      )}

      {/* Progress across the top, one segment per item, the way stories read.
          It is the only permanent chrome, and it is 2px. */}
      {count > 1 && (
        <div className="absolute inset-x-0 top-0 flex gap-1 p-2">
          {items.map((_, i) => (
            <span
              key={i}
              className={`h-[3px] flex-1 rounded-full ${i === position ? 'bg-white' : 'bg-white/30'}`}
            />
          ))}
        </div>
      )}

      {item.invitation && (
        <p className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 to-transparent px-8 pt-20 pb-10 text-center text-lg text-balance text-white">
          {item.invitation}
        </p>
      )}

      {/* The tap zones. Invisible and above everything except the close button,
          because anything drawn here is drawn on top of somebody's artwork. */}
      <button
        type="button"
        aria-label="Previous"
        onClick={() => go(-1)}
        className="absolute inset-y-0 left-0 w-1/2 cursor-w-resize focus-visible:bg-white/5"
      />
      <button
        type="button"
        aria-label="Next"
        onClick={() => go(1)}
        className="absolute inset-y-0 right-0 w-1/2 cursor-e-resize focus-visible:bg-white/5"
      />

      {/* Esc is unreachable on a touch panel, so this is not a duplicate. Above
          the tap zones, or the right half of the screen would swallow it. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute top-4 right-4 z-10 grid size-10 place-items-center rounded-full bg-black/40 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/70"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          aria-hidden
          className="size-5"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
