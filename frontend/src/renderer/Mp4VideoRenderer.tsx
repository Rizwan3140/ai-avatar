import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { bus } from '../bus/bus.ts'
import type { Emotion } from '../bus/events.ts'
import type { DigitalHumanRenderer, Pose } from './renderer.types.ts'
import config from './renderer.config.ts'
import { avatarMedia, onAvatarMedia, visiblePose } from './renderer.avatar.ts'
import { keepPlaying, preloadClips, startIdlePresence } from './animation.ts'

const POSES: Pose[] = ['idle', 'listen', 'think', 'speak']

/**
 * Renderer-owned state. Pose is not status: booting and sleeping are not poses.
 *
 * `live` is whether he is in a conversation. Out of one he is a still poster —
 * a figure moving at an empty room is unsettling, and coming alive the moment
 * someone engages him is the whole first impression.
 */
const useRenderer = create<{ pose: Pose; present: boolean; live: boolean }>(() => ({
  pose: 'idle',
  present: true,
  live: false,
}))

const set = useRenderer.setState

/**
 * The MP4 implementation of DigitalHumanRenderer.
 *
 * Every clip plays continuously for the whole session; poses are opacity, never
 * pause/play. Pausing freezes a frame and playing costs a decode hitch — both
 * read instantly as software. Sleep is the one exception, because nobody is
 * watching.
 */
export const mp4Renderer: DigitalHumanRenderer = {
  async initialize() {
    await preloadClips(Object.values(avatarMedia().clips))
  },
  // idle() means "no conversation", so it drops back to the still poster.
  // The other three only ever happen inside one.
  idle: () => set({ pose: 'idle', present: true, live: false }),
  listen: () => set({ pose: 'listen', present: true, live: true }),
  think: () => set({ pose: 'think', present: true, live: true }),
  speak: () => set({ pose: 'speak', present: true, live: true }),
  stop: () => set({ present: false, live: false }),

  setEmotion(_emotion: Emotion) {
    // Deliberately inert. There is no emotional footage in v1, and inventing a
    // visual response to fill the interface would be adding functionality at the
    // cost of believability. The seam is what has value today: a renderer with
    // per-emotion clips drops in here without Conversation changing.
  },
}

// The renderer reacts to the bus itself. Nobody calls it.
bus.on('SYSTEM_READY', () => mp4Renderer.idle())
bus.on('SESSION_STARTED', () => mp4Renderer.listen())
bus.on('SESSION_ENDED', () => mp4Renderer.idle())
bus.on('USER_STARTED_SPEAKING', () => mp4Renderer.listen())
bus.on('USER_UTTERANCE', () => mp4Renderer.think())
bus.on('SPEECH_STARTED', () => mp4Renderer.speak())
bus.on('SPEECH_ENDED', () => mp4Renderer.listen())
bus.on('REPLY_ABORTED', () => mp4Renderer.listen())
bus.on('SESSION_SLEEP', () => mp4Renderer.stop())
bus.on('SESSION_WAKE', () => mp4Renderer.idle())
bus.on('EMOTION_CHANGED', ({ emotion }) => mp4Renderer.setEmotion(emotion))

export function Mp4VideoRenderer() {
  const { pose, present, live } = useRenderer()
  const videos = useRef<Record<string, HTMLVideoElement | null>>({})
  /** Poses whose clip failed to load. Footage arrives one file at a time. */
  const [missing, setMissing] = useState<ReadonlySet<Pose>>(new Set())
  const [media, setMedia] = useState(avatarMedia)

  // The kiosk learns who it is at boot, and can be re-pointed at a different
  // avatar without a rebuild.
  useEffect(() => onAvatarMedia(setMedia), [])

  // Any pose without footage falls back to idle, so a half-finished avatar still
  // moves rather than freezing the moment someone speaks to him.
  const shown: Pose = visiblePose(media.clips, pose, missing)

  useEffect(() => {
    const idle = videos.current.idle
    if (!idle) return
    return startIdlePresence(idle)
  }, [])

  // Sleep is the only place pausing is correct — the screen is dark and nobody
  // is watching, so the decode cost of resuming is invisible and worth saving.
  useEffect(() => {
    for (const el of Object.values(videos.current)) {
      if (!el) continue
      if (present) keepPlaying(el)
      else el.pause()
    }
  }, [present])

  return (
    <div
      className="absolute inset-0 transition-opacity"
      style={{
        opacity: present ? 1 : 0,
        transitionDuration: `${config.crossfadeDuration * 2}ms`,
        animation: `breathe ${config.breathingPeriod}ms ease-in-out infinite`,
        // Breathe from the floor, so his feet stay planted while his chest moves.
        transformOrigin: 'bottom center',
      }}
    >
      {/* Poster sits under every clip: no black flash before decode, and the
          only thing visible until the footage exists. */}
      <img
        src={media.poster}
        alt=""
        aria-hidden
        className="absolute inset-0 size-full object-bottom"
        style={{ objectFit: config.fit }}
        onError={(e) => {
          // No footage for this avatar yet — fall back to the placeholder rather
          // than showing a broken image.
          const img = e.currentTarget
          if (img.src.endsWith(config.posterFallback)) return
          img.src = config.posterFallback
        }}
      />

      {POSES.map((name) => (
        <video
          key={name}
          ref={(el) => {
            videos.current[name] = el
          }}
          src={media.clips[name]}
          poster={media.poster}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          aria-hidden
          onError={() => setMissing((prev) => new Set(prev).add(name))}
          className="absolute inset-0 size-full object-bottom transition-opacity"
          style={{
            objectFit: config.fit,
            // Every clip keeps playing regardless; only visibility changes. Out
            // of a conversation they all fade out and the poster shows through.
            opacity: live && shown === name ? 1 : 0,
            transitionDuration: `${config.crossfadeDuration}ms`,
            transitionTimingFunction: 'var(--ease-human)',
          }}
        />
      ))}

      {/* Multiply, not a layer underneath — the footage has an opaque white
          background, so anything behind it is simply hidden. Multiplying leaves
          white untouched and darkens only where the shadow falls, which also
          means it works over the clips without re-encoding them. */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2"
        style={{
          width: `${config.shadowWidth}vh`,
          height: `${config.shadowHeight}vh`,
          mixBlendMode: 'multiply',
          background: `radial-gradient(ellipse at center,
            rgba(0,0,0,${config.shadowOpacity}) 0%,
            rgba(0,0,0,${config.shadowOpacity * 0.35}) 45%,
            rgba(0,0,0,0) 72%)`,
        }}
      />
    </div>
  )
}
