/**
 * What the showroom is wearing today.
 *
 * A season is a handful of token values that arrive with the cabinet's identity
 * and are written onto the document root. Every colour and face in the interface
 * already resolves through a CSS custom property, so overriding four of them
 * re-dresses the whole panel — the kiosk and the Studio both — without a build,
 * a deploy, or a visit to the machine.
 *
 * Applied with `setProperty` rather than by writing a `<style>` block. A value
 * that arrived over the network cannot escape a declaration this way: the DOM
 * refuses anything that is not a valid value for that property, where a string
 * concatenated into CSS would happily close the rule and open another. The
 * server whitelists names and validates values as well; this is the second lock.
 */

/** The only properties a season may touch. The server enforces the same list —
 *  this copy is what stops a compromised or simply wrong response from
 *  repainting something that was never meant to move. */
const ALLOWED = new Set([
  '--color-accent',
  '--color-ink-soft',
  '--color-line',
  '--font-display',
])

/** Cleared before each apply so a season ending does not need a reload: the
 *  cabinet drops back to the everyday look on its next sync. */
let applied: string[] = []

export function applySeason(tokens: Record<string, string> | null | undefined): void {
  const root = document.documentElement
  for (const name of applied) root.style.removeProperty(name)
  applied = []

  if (!tokens) return
  for (const [name, value] of Object.entries(tokens)) {
    if (!ALLOWED.has(name) || typeof value !== 'string') continue
    root.style.setProperty(name, value)
    applied.push(name)
  }
}
