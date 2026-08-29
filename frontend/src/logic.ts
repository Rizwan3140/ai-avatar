/**
 * Pure functions. No DOM, no bus, no state — so they are directly testable with
 * `node --test` and nothing else. Both are load-bearing for the illusion:
 * splitSentences decides how fast she starts talking, isEcho decides whether she
 * talks to herself.
 */

/** Words that end in a period without ending a sentence. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs',
  'etc', 'eg', 'ie', 'approx', 'inc', 'ltd', 'co',
])

const TERMINATORS = '.!?'

/**
 * Cut a streaming buffer into complete sentences, holding back whatever might
 * still be growing. Called on every token chunk; the returned remainder is fed
 * back in with the next chunk.
 */
export function splitSentences(buffer: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = []
  let start = 0

  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i]

    if (ch === '\n') {
      push(buffer.slice(start, i))
      start = i + 1
      continue
    }

    if (!TERMINATORS.includes(ch)) continue

    // Collapse runs so "?!" and "..." cut once, after the last terminator.
    let end = i
    while (end + 1 < buffer.length && TERMINATORS.includes(buffer[end + 1])) end++

    const next = buffer[end + 1]
    // Nothing after the terminator yet, so we cannot know the sentence is over —
    // the next token may turn "$14." into "$14.99". Hold it for the next chunk.
    if (next === undefined) break
    if (!/\s/.test(next)) {
      i = end
      continue
    }
    if (ch === '.' && endsWithAbbreviation(buffer, i)) {
      i = end
      continue
    }

    push(buffer.slice(start, end + 1))
    start = end + 1
    i = end
  }

  return { sentences, remainder: buffer.slice(start) }

  function push(raw: string) {
    const trimmed = raw.trim()
    if (trimmed) sentences.push(trimmed)
  }
}

function endsWithAbbreviation(buffer: string, dot: number): boolean {
  let j = dot - 1
  while (j >= 0 && /[A-Za-z.]/.test(buffer[j])) j--
  const word = buffer.slice(j + 1, dot).replace(/\./g, '').toLowerCase()
  if (!word) return false
  // "J. Smith" — a lone initial is never a sentence end.
  if (word.length === 1) return true
  return ABBREVIATIONS.has(word)
}

/**
 * True when a transcript is the speaker feeding back into the microphone rather
 * than a person interrupting.
 *
 * The marker that used to sit here said an exact substring match was good enough
 * for a normal room, and that the enclosure echoing was the case that would break
 * it. The enclosure echoed. In a glass cabinet with separate speakers, browser
 * `echoCancellation` — which assumes the microphone and the speaker are the same
 * device — removes far less than it does on a laptop.
 *
 * Two things had to change, and only one of them was here.
 *
 * The caller used to ask this only while `isSpeaking()` was true. A turn ends
 * after 700ms of silence and then waits on transcription, so a transcript arrives
 * more than a second after he stopped talking — by which point he is not
 * speaking, the guard was false, and this function was never called at all. That
 * is the whole bug: not a weak filter, an unreached one.
 *
 * And an exact match cannot catch it even when reached, because Whisper does not
 * hear an echo cleanly. "I'll be here" came back as "I'll be there", "I'll be
 * good", "I'll be it". So this compares word overlap against everything he said
 * recently, not a substring against the sentence in flight.
 *
 * Cost of a false positive: one utterance ignored, and the visitor repeats
 * themselves. Cost of a false negative: he answers himself every five seconds
 * until someone walks away. The threshold leans accordingly.
 */
export function isEcho(transcript: string, spoken: string | string[]): boolean {
  const heard = normalize(transcript)
  if (!heard) return true

  const recent = (Array.isArray(spoken) ? spoken : [spoken]).map(normalize).filter(Boolean)
  if (!recent.length) return false

  // Still catches the clean case a directional mic gives us, and costs nothing.
  if (recent.some((said) => said.includes(heard))) return true

  const words = heard.split(' ').filter(Boolean)
  if (!words.length) return true
  const said = new Set(recent.join(' ').split(' '))
  const overlap = words.filter((w) => said.has(w)).length / words.length

  // A long transcript sharing most of its words with what he just said is still
  // him; a short one needs to be nearly all his, because "the linen shirt" is a
  // thing a visitor genuinely says right after he has said it.
  return words.length <= 3 ? overlap === 1 : overlap >= 0.7
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
