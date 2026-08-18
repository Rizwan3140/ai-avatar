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
