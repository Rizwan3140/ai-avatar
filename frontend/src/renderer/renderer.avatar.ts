import config from './renderer.config.ts'
import type { Pose } from './renderer.types.ts'

/**
 * The media for whoever this kiosk is currently showing.
 *
 * Separate from renderer.config because those are tunables a person adjusts,
 * while this arrives from the backend at boot and changes when a different
 * avatar is assigned to the cabinet.
 */
export type AvatarMedia = {
  id: string
  poster: string
  clips: Partial<Record<Pose, string>>
}

let current: AvatarMedia = {
  id: '',
  poster: config.posterFallback,
  clips: {},
}

const listeners = new Set<(media: AvatarMedia) => void>()

export function avatarMedia(): AvatarMedia {
  return current
}

export function setAvatarMedia(media: AvatarMedia): void {
  // No poster means no footage has been produced for this avatar yet. Show the
  // placeholder rather than a broken image.
  current = { ...media, poster: media.poster || config.posterFallback }
  listeners.forEach((fn) => fn(current))
}

export function onAvatarMedia(fn: (media: AvatarMedia) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}


/**
 * Which clip actually plays for a pose.
 *
 * Two ways a pose can have no footage, and only one of them announces itself:
 *
 *   - the clip failed to load — the `<video>` fires `onError` and lands in `missing`
 *   - the clip was never there — `clips[pose]` is undefined, so the element gets
 *     no `src`, never attempts a load, and never errors
 *
 * The second case is the normal one for a half-finished avatar, and checking only
 * `missing` left it showing an empty video element at full opacity while the idle
 * clip sat behind it at zero. He froze the instant anyone spoke to him.
 */
export function visiblePose(
  clips: Partial<Record<Pose, string>>,
  pose: Pose,
  missing: ReadonlySet<Pose>,
): Pose {
  if (clips[pose] && !missing.has(pose)) return pose
  return 'idle'
}
