/**
 * The showroom and selfie screens fill the display: no tabs, no address bar.
 *
 * Opened from the studio they arrived in a new tab with Chrome's tab strip
 * across the top, and maximising the window by hand left it there. A page
 * cannot go fullscreen on its own - the browser allows it only in answer to
 * something the person did - so the first tap or key press does it, and the
 * next does it again if anything took it out of fullscreen. The tap still
 * does what it was for. A cabinet started with Chrome's `--kiosk` is already
 * fullscreen and nothing here changes.
 */
type Screen = {
  fullscreenElement: Element | null
  documentElement: { requestFullscreen?: (options?: FullscreenOptions) => Promise<void> }
}

/** Fullscreen, unless it already is or the browser has no such thing. */
export function fillScreen(screen: Screen = document): void {
  if (screen.fullscreenElement || !screen.documentElement.requestFullscreen) return
  // Refused when the browser does not count the event as the person's: the
  // next one will be.
  screen.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
}

/** Every tap and key press from now on asks for it. Released taps, not
 *  presses: a touch only counts as the person's when the finger lifts. */
export function fillScreenOnTouch(target: EventTarget = window): void {
  for (const type of ['pointerup', 'keydown']) {
    target.addEventListener(type, () => fillScreen(), { capture: true, passive: true })
  }
}
