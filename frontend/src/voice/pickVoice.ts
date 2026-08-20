import config from './voice.config.ts'

/**
 * Which browser voice speaks for this avatar.
 *
 * Pure, and separated from `tts.ts`, because getting it wrong is inaudible in
 * code review and unmissable in a showroom: the list this replaced was entirely
 * female, so a male avatar spoke in a woman's voice from the first day.
 *
 * Order of authority:
 *   1. an exact voice name set on the avatar — an operator who typed a name meant it
 *   2. the gender list, best available first
 *   3. any voice whose name suggests that gender, since platform names vary wildly
 *   4. the ungendered preference list
 *   5. the avatar's language, then any English voice, then whatever exists
 *
 * Never returns null when the browser has any voice at all. A kiosk that stays
 * silent because it did not like the available voices is worse than one with the
 * wrong accent.
 */

/**
 * Names that betray a gender when the exact voice is not on our list.
 *
 * Real voice names from Windows (Microsoft Natural), Chrome and macOS, not
 * invented ones — the point is to recognise a voice we did not anticipate on a
 * machine we have never seen, which is most machines.
 *
 * Regex literals rather than `new RegExp("...")`: in a string, a lone backslash-b
 * is a backspace character, not a word boundary, and the mistake is silent — the
 * pattern compiles and simply never matches.
 */
const HINTS: Record<string, RegExp> = {
  male: /\b(male|man|guy|andrew|brian|davis|christopher|eric|jacob|jason|roger|steffan|tony|brandon|ryan|alfie|elliot|ethan|noah|oliver|thomas|daniel|alex|fred|rishi|george|james|mark|david|william|liam|ravi|raj|arjun)\b/i,
  female: /\b(female|woman|aria|jenny|amber|ana|ashley|cora|elizabeth|emma|jane|michelle|monica|nancy|sara|sonia|libby|abbi|bella|hollie|maisie|olivia|samantha|karen|moira|tessa|victoria|serena|zira|susan|linda|allison|ava|hazel|heera|priya|neerja)\b/i,
}

export type VoiceLike = { name: string; lang: string }

export function pickVoice<T extends VoiceLike>(
  voices: readonly T[],
  options: { gender?: string; voice?: string; lang?: string } = {},
): T | null {
  if (!voices.length) return null

  const lang = options.lang || config.lang
  const gender = (options.gender || '').toLowerCase()
  const byName = (name: string) => voices.find((v) => v.name === name)

  // 1. An operator typed an exact name. Honour it even if we would not have
  //    chosen it — that is the whole point of the field.
  if (options.voice) {
    const exact = byName(options.voice)
    if (exact) return exact
  }

  // 2. Our preference list for this gender.
  const preferred = config.voicesByGender[gender]
  if (preferred) {
    const found = preferred.map(byName).find(Boolean)
    if (found) return found

    // 3. Nothing on the list is installed. Platform voice names are not
    //    standardised, so fall back to reading the name — a "Microsoft Andrew"
    //    we have never heard of is still a better guess than a coin flip.
    const hinted = voices.find((v) => HINTS[gender]?.test(v.name))
    if (hinted) return hinted
  }

  // 4-5. No gender, or no match for it.
  return (
    config.preferredVoices.map(byName).find(Boolean) ??
    voices.find((v) => v.lang.replace('_', '-') === lang) ??
    voices.find((v) => v.lang.startsWith('en')) ??
    voices[0]
  )
}
