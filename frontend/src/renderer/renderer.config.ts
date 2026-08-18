/**
 * Which kiosk this machine is. The backend answers with the avatar assigned to
 * it, so a cabinet is re-pointed at a different digital human without rebuilding
 * anything. Override per machine with VITE_KIOSK_ID.
 */
export const KIOSK_ID = import.meta.env?.VITE_KIOSK_ID || 'default'

/** Every tunable in one place. Nothing about his presence is hardcoded. */
export default {
  /** Media is filled in at boot from /api/kiosk/{id}. See renderer.avatar.ts. */
  posterFallback: '/poster.svg',

  /** Crossfade between poses. Nothing snaps. */
  crossfadeDuration: 250,

  /**
   * Contact shadow at his feet. The only thing that stops a cut-out figure
   * reading as a sticker on a white page — an object touching a floor darkens
   * it, and the eye notices the absence long before it names the cause.
   *
   * Sized in vh so it tracks him: the footage is height-limited on any screen
   * wider than 9:16, so his scale follows viewport height, not width.
   */
  shadowWidth: 26,
  shadowHeight: 5,
  shadowOpacity: 0.3,

  /**
   * How the footage meets the screen.
   *
   * 'contain' shows him whole, whatever the screen is. On the cabinet this is
   * indistinguishable from 'cover' — poster, clips and panel are all exactly
   * 9:16 (1080x1920, 2160x3840), so there is nothing to crop and nothing to
   * letterbox. It only differs off the target hardware.
   *
   * That difference is the reason for this setting. 'cover' fills the width and
   * crops the overflow off the top, so a landscape monitor scales him to well
   * over twice its height and shows the bottom slice: a screen of knees. Anyone
   * running this on a laptop sees that and reasonably concludes it is broken.
   *
   * The margin of page-white beside him in landscape is not a compromise — the
   * background is white on purpose, so he simply reads as a person standing in
   * a wide white room.
   *
   * Switch back to 'cover' only for a panel whose ratio is far from 9:16 and
   * where edge-to-edge matters more than his head. Panels vary; this is meant
   * to be tuned on the glass.
   */
  fit: 'contain' as 'cover' | 'contain',

  /**
   * Idle presence. A looping clip is an exact loop and the eye finds the seam
   * inside a minute, so the loop period is deliberately made non-integer.
   * Randomising playback rate is cheap; a long clip does most of the work.
   */
  idleRateJitter: [0.97, 1.03] as [number, number],
  idleJitterInterval: [4000, 8000] as [number, number],

  /** Container scale amplitude layered over footage that already breathes. */
  breathingStrength: 0.006,
  /** Co-prime with any sane clip length so the composite never exactly repeats. */
  breathingPeriod: 7300,

  /**
   * Held before the reply starts, so thought reads as thought.
   *
   * Zero on purpose. This existed to stop an instant answer feeling robotic, but
   * local transcription already costs the best part of a second — the pause is
   * real now, and adding more on top just makes her slow.
   */
  thinkingDelay: 0,
  /** After the crossfade lands, before the first phoneme. */
  speechDelay: 120,

  /** Idle this long and she sleeps. OLED kiosks run for months. */
  sleepAfter: 3 * 60 * 1000,
  /** Burn-in: nudge static elements this far, this often. */
  burnInShift: 3,
  burnInInterval: 60 * 1000,
} as const
