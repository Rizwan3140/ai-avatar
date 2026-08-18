import type { Product } from '../bus/events.ts'

/**
 * Turning what someone said into which product they meant.
 *
 * A visitor does not tap through a grid — they say "the next one", "the cheaper
 * one", "tell me about that". Without this, every such sentence goes to the
 * model as a fresh question with no idea what "that" is, and the answer is
 * about the wrong product or about nothing.
 *
 * Pure and tested. It runs on every utterance during a conversation, so getting
 * it wrong is a customer being shown the wrong thing.
 */

export type Navigation =
  | { kind: 'select'; product: Product }
  | { kind: 'clear' }
  /** "Can I try that on?" — selects the product *and* opens the camera flow. */
  | { kind: 'tryon'; product: Product }
  | { kind: 'none' }

const NEXT = /\b(next|another|other one|something else|show me more)\b/i
const PREVIOUS = /\b(previous|last one|go back|the one before)\b/i
const CHEAPEST = /\b(cheap(er|est)?|less expensive|lower price|budget|affordable)\b/i
const DEAREST = /\b(expensive|premium|dearer|top of the range|best one|highest)\b/i
const DISMISS =
  /\b(never ?mind|forget (it|that|those)|go back to you|(hide|close|clear|remove)\s+(them|those|these|that|it|this)?)\b/i
/** "that one", "this", "it" — only meaningful when something is already shown. */
const PRONOUN = /\b(that one|this one|that|this|it)\b/i

/**
 * "Try it on", "try the Titan Pro on", "how would that look on me".
 *
 * A camera opening on a member of the public who did not ask for one is the
 * worst false positive in this product, so the bare verb is never enough:
 *
 * - `try … on` needs the preposition, which is why "try the other one" stays
 *   navigation — "one" does not match `\bon\b`.
 * - `try to …` is excluded outright. "I'll try to come back tomorrow" is a
 *   goodbye, not a request to be photographed.
 * - The gap between verb and preposition is bounded and cannot cross a sentence
 *   end, so "try this. Are you open on Sunday?" does not join up.
 */
const TRY_ON = new RegExp(
  [
    String.raw`\btry(?:ing)?\s+(?!to\b)[^.?!]{0,40}?\bon\b`,
    String.raw`\bon (?:me|myself)\b`,
    String.raw`\b(?:look|suit|fit)s?\s+(?:good\s+)?on me\b`,
    String.raw`\bwear(?:ing)? (?:it|that|this)\b`,
  ].join('|'),
  'i',
)

const byPrice = (products: Product[]) =>
  [...products].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))

/**
 * Ordinals people actually say. "The first one" is common; "the seventh" is not,
 * because nobody scans past a handful of cards before asking a question instead.
 *
 * Cardinals are deliberately absent. "One" reads as an ordinal and is not — in
 * speech it is a pronoun: "the last one", "the premium one", "that one". Treating
 * it as "the first" hijacks almost every phrase before any other rule can run.
 */
const ORDINALS: Record<string, number> = {
  first: 0, '1st': 0,
  second: 1, '2nd': 1,
  third: 2, '3rd': 2,
  fourth: 3, '4th': 3,
  fifth: 4, '5th': 4,
  last: -1,
}

function byName(text: string, products: Product[]): Product | null {
  const said = text.toLowerCase()
  // Longest name first, so "Titan Pro 16" wins over a product merely called
  // "Titan" when both exist.
  const candidates = [...products].sort((a, b) => b.name.length - a.name.length)
  for (const product of candidates) {
    if (said.includes(product.name.toLowerCase())) return product
    // Distinctive words only — "laptop" matches everything and means nothing.
    const distinctive = product.name.split(/\s+/).filter((w) => w.length > 3)
    if (distinctive.length && distinctive.every((w) => said.includes(w.toLowerCase()))) {
      return product
    }
  }
  return null
}

export function resolve(text: string, products: Product[], selected: Product | null): Navigation {
  if (DISMISS.test(text)) return { kind: 'clear' }
  if (!products.length) return { kind: 'none' }

  const named = byName(text, products)

  // Before every other rule. "Can I try the linen shirt on?" names a product and
  // asks to wear it, and resolving it as a plain selection loses the second half
  // of the sentence — the visitor then has to say it again to a screen that
  // apparently ignored them.
  if (TRY_ON.test(text)) {
    const target = named ?? selected ?? (products.length === 1 ? products[0] : null)
    // With several things on screen and no way to tell which they meant, asking
    // beats photographing someone in the wrong garment.
    if (target) return { kind: 'tryon', product: target }
  }

  if (named) return { kind: 'select', product: named }

  for (const [word, index] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) {
      const product = index === -1 ? products.at(-1) : products[index]
      if (product) return { kind: 'select', product }
    }
  }

  if (CHEAPEST.test(text)) return { kind: 'select', product: byPrice(products)[0] }
  if (DEAREST.test(text)) return { kind: 'select', product: byPrice(products).at(-1)! }

  const at = selected ? products.findIndex((p) => p.id === selected.id) : -1

  if (NEXT.test(text)) {
    // Wrap rather than stop. "Show me another" at the end of a short list should
    // keep going round, not silently do nothing.
    return { kind: 'select', product: products[(at + 1) % products.length] }
  }

  if (PREVIOUS.test(text) && at > 0) {
    return { kind: 'select', product: products[at - 1] }
  }

  // "Tell me about that" with something already chosen means that one. With
  // nothing chosen it means the first thing on screen.
  if (PRONOUN.test(text)) {
    return { kind: 'select', product: selected ?? products[0] }
  }

  return { kind: 'none' }
}

/**
 * What the model needs to know about what is on screen. Without it, "is that
 * good for gaming?" is answered about nothing in particular.
 */
export function context(products: Product[], selected: Product | null): string {
  if (!products.length) return ''
  const lines = products.map(
    (p) => `- ${p.name}${p.spoken_price ? ` at ${p.spoken_price}` : ''}`,
  )
  const focus = selected
    ? `\nThe visitor is looking at the ${selected.name}. "this", "that" and "it" mean that one.`
    : ''
  return `Currently on screen:\n${lines.join('\n')}${focus}`
}
