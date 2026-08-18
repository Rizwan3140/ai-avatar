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
 * ponytail: substring match against what is being spoken right now. Good enough
 * for a normal room with a directional mic. If the kiosk enclosure echoes,
 * replace with an AudioWorklet RMS gate on the getUserMedia stream
 * (echoCancellation: true) — this filter cannot tell a quiet echo from a quiet
 * person.
 */
export function isEcho(transcript: string, spoken: string): boolean {
  const heard = normalize(transcript)
  if (!heard) return true
  const said = normalize(spoken)
  if (!said) return false
  return said.includes(heard)
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
