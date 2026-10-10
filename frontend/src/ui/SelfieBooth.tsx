import { useEffect, useRef, useState } from 'react'
import { bus } from '../bus/bus.ts'
import { fetchCharacter, type Character } from './booth.ts'
import { Selfie } from './Selfie.tsx'

/**
 * The selfie screen: a character, and one thing to do.
 *
 * A thing by itself. It was first a chip under the showroom avatar, then a
 * screen that borrowed that avatar — their footage, their boot sequence, the
 * microphone and the conversation that came with them, none of which a
 * photograph needs. Now it is given a character by id and asks the server for
 * nothing else: no avatar, no session, and nothing on this page listens.
 *
 * What stands on the panel is the character's own picture, and for the count
 * their clip of getting ready, played once from its first frame.
 */
export function SelfieBooth() {
  const [who, setWho] = useState<Character | null>(null)
  const [problem, setProblem] = useState('')
  const [posing, setPosing] = useState(false)
  const clip = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id')?.trim() ?? ''
    fetchCharacter(id)
      .then(setWho)
      .catch((failure) => setProblem((failure as Error).message))
  }, [])

  useEffect(() => bus.on('SELFIE_POSING', ({ posing }) => setPosing(posing)), [])

  // Getting ready is started, not looped: five or six seconds of lifting a
  // phone means nothing from the middle. It plays from its first frame when
  // the count begins, holds its last when it runs out, and is put away once it
  // has faded.
  useEffect(() => {
    const video = clip.current
    if (!video) return
    if (posing) {
      video.currentTime = 0
      void video.play().catch(() => {})
      return
    }
    const away = setTimeout(() => video.pause(), 500)
    return () => clearTimeout(away)
  }, [posing])

  const usable = who !== null && who.available && Boolean(who.picture)
  const stand = 'absolute inset-0 size-full object-contain object-bottom'

  return (
    <main className="kiosk-root bg-canvas relative flex h-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1">
        {who?.picture && <img src={who.picture} alt="" aria-hidden className={stand} />}
        {who?.clip && (
          <video
            ref={clip}
            src={who.clip}
            muted
            playsInline
            preload="auto"
            aria-hidden
            className={`${stand} transition-opacity duration-500 ease-(--ease-human)`}
            style={{ opacity: posing ? 1 : 0 }}
          />
        )}
      </div>

      {/* A camera, at the right edge, halfway up — where the showroom screen
          keeps its microphone, so the one thing to press is where a hand
          already goes. Out of the way for the count; the cards the selfie
          itself puts up are painted above it. */}
      {usable && !posing && (
        <button
          type="button"
          onClick={() => bus.emit('SELFIE_REQUESTED')}
          aria-label={`Take a selfie with ${who.name}`}
          className="lay-down bg-ink shadow-float absolute top-1/2 right-safe z-20 grid size-[clamp(56px,6.5vh,240px)] -translate-y-1/2 place-items-center rounded-full text-white transition-transform duration-300 ease-(--ease-human) hover:scale-105 active:scale-95"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="size-[46%]"
          >
            <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2.5h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
            <circle cx="12" cy="13" r="3.3" />
          </svg>
        </button>
      )}

      {/* Why there is no camera to press, said where the button would be
          looked for. A blank panel is a broken one to whoever set it up. */}
      {!usable && (problem || who) && (
        <p className="text-ink-soft text-body absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-safe text-center text-balance">
          {problem ||
            (who && !who.available
              ? 'Selfies are switched off on this machine.'
              : `${who?.name} has no picture yet. Add one in the studio's Selfie tab.`)}
        </p>
      )}

      {usable && <Selfie who={who} />}
    </main>
  )
}
