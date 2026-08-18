import { useEffect, useRef, useState } from 'react'
import { bus } from '../bus/bus.ts'
import { useStore } from '../state/store.ts'
import config from '../voice/voice.config.ts'

/**
 * Diagnostic overlay. Not part of the installation.
 *
 * The commandments say the visitor never sees a message list, and that still
 * holds — this exists to answer one question while building: is she hearing what
 * you actually said? It shows live partials, what was accepted, what the echo
 * filter threw away, what she replied, and whether the recogniser is even
 * running.
 *
 * Hidden in production builds. Press ` (backtick) to toggle.
 */
type Line = {
  kind: 'you' | 'her' | 'echo' | 'system'
  text: string
  /** Repeats of the same line collapse — one fault should read as one fault. */
  count: number
}

const MAX_LINES = 60

export function Transcript() {
  const [open, setOpen] = useState(import.meta.env?.DEV ?? false)
  const [lines, setLines] = useState<Line[]>([])
  const [interim, setInterim] = useState('')
  const [mic, setMic] = useState(false)
  const status = useStore((s) => s.status)
  const name = useStore((s) => s.name)
  const scroller = useRef<HTMLDivElement>(null)
  const meter = useRef<HTMLDivElement>(null)
  const peakRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const add = (kind: Line['kind'], text: string) =>
      setLines((prev) => {
        const last = prev.at(-1)
        if (last && last.kind === kind && last.text === text) {
          return [...prev.slice(0, -1), { ...last, count: last.count + 1 }]
        }
        return [...prev, { kind, text, count: 1 }].slice(-MAX_LINES)
      })

    const off = [
      bus.on('USER_INTERIM', ({ text }) => setInterim(text)),
      bus.on('USER_UTTERANCE', ({ text }) => {
        setInterim('')
        add('you', text)
      }),
      bus.on('USER_DISCARDED', ({ text }) => add('echo', text)),
      bus.on('REPLY_COMPLETE', ({ text }) => add('her', text)),
      bus.on('SESSION_ENDED', () => setInterim('')),
      bus.on('SYSTEM_ERROR', ({ message }) => add('system', message)),
      bus.on('RECOGNITION_STATE', ({ running, error }) => {
        setMic(running)
        if (error) add('system', error)
      }),
      // Written straight to the DOM. This fires many times a second and would
      // re-render the whole panel through React state.
      bus.on('MIC_LEVEL', ({ level }) => {
        if (meter.current) meter.current.style.width = `${Math.min(100, level * 600)}%`
        if (peakRef.current && level > 0.001) {
          peakRef.current.textContent = level.toFixed(3)
        }
      }),
      // Did voice activity detection actually fire? If this line never appears
      // while you speak, the problem is the threshold, not the transcription.
      bus.on('VOICE_ACTIVITY', ({ durationMs, peak }) => {
        const seconds = (durationMs / 1000).toFixed(1)
        add(
          'system',
          durationMs < 200
            ? `ignored ${seconds}s blip (peak ${peak.toFixed(3)})`
            : `heard ${seconds}s (peak ${peak.toFixed(3)}) — transcribing`,
        )
      }),
    ]

    const toggle = (e: KeyboardEvent) => {
      if (e.key === '`') setOpen((v) => !v)
    }
    document.addEventListener('keydown', toggle)

    return () => {
      off.forEach((fn) => fn())
      document.removeEventListener('keydown', toggle)
    }
  }, [])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [lines, interim])

  if (!open) return null

  return (
    <aside className="pointer-events-none absolute bottom-6 left-6 z-20 flex w-[min(32vw,400px)] flex-col overflow-hidden rounded-2xl bg-black/70 text-white shadow-float backdrop-blur-xl">
      <header className="flex items-center gap-2 px-4 py-2 text-[10px] tracking-[0.18em] text-white/45 uppercase">
        <span
          className={`size-[7px] rounded-full ${mic ? 'bg-emerald-400' : 'bg-white/25'}`}
          style={mic ? { animation: 'dot 1.4s ease-in-out infinite' } : undefined}
        />
        <span>{mic ? 'mic open' : 'mic closed'}</span>
        <span className="ml-auto">{status}</span>
        <span className="text-white/25">` hide</span>
      </header>

      {/* Live input level — proof the microphone is hearing you, before any
          words have been transcribed. */}
      <div className="mx-4 mb-1 h-[3px] overflow-hidden rounded-full bg-white/10">
        <div ref={meter} className="h-full w-0 rounded-full bg-emerald-400/80 transition-[width] duration-75" />
      </div>
      {/* If level never approaches the threshold while you talk, that is the
          bug — no amount of transcription will help. */}
      <div className="mb-2 flex justify-between px-4 text-[10px] text-white/35">
        <span>
          level <span ref={peakRef}>0.000</span>
        </span>
        <span>speech ≥ {config.voiceThreshold} · barge-in ≥ {config.bargeInThreshold}</span>
      </div>

      <div ref={scroller} className="max-h-[38vh] space-y-2 overflow-y-auto px-4 pb-3 text-[13px] leading-snug">
        {lines.length === 0 && !interim && (
          <p className="py-2 text-white/35">
            {mic ? 'Listening — say something.' : 'Tap the microphone to start.'}
          </p>
        )}

        {lines.map((line, i) => (
          <p key={i} className={style(line.kind)}>
            <span className="mr-2 text-[10px] tracking-wider text-white/35 uppercase">
              {label(line.kind, name)}
            </span>
            {line.text}
            {line.count > 1 && <span className="ml-2 text-white/35">×{line.count}</span>}
          </p>
        ))}

        {/* Live partial — proof the microphone is actually open. */}
        {interim && <p className="text-accent/80 italic">{interim}…</p>}
      </div>
    </aside>
  )
}

function label(kind: Line['kind'], name: string) {
  if (kind === 'you') return 'you'
  // Whoever the backend says he or she is — never a name baked into the UI.
  if (kind === 'her') return name.toLowerCase() || 'avatar'
  if (kind === 'echo') return 'echo'
  return '!'
}

function style(kind: Line['kind']) {
  if (kind === 'you') return 'text-white'
  if (kind === 'her') return 'text-white/70'
  if (kind === 'system') return 'text-amber-300'
  // Discarded as her own voice returning through the mic. If your real words
  // keep landing here, the filter is too aggressive for this room.
  return 'text-white/30 line-through'
}
