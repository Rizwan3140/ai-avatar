export default {
  lang: 'en-US',

  /**
   * Preferred voices per gender, best first.
   *
   * Split because the single list this replaced opened with "Google UK English
   * Female" and continued with Aria, Jenny and Samantha — every one of them a
   * woman. A male avatar therefore spoke in a woman's voice, on every platform,
   * from the first day. Nobody notices reading code; everybody notices hearing it.
   *
   * Browser voice names are wildly inconsistent across platforms, so these are
   * preferences and not guarantees. Each list runs Windows, then Chrome, then
   * macOS, and the first available en-* voice is the floor beneath all of them.
   */
  voicesByGender: {
    male: [
      'Microsoft Guy Online (Natural) - English (United States)',
      'Microsoft Ryan Online (Natural) - English (United Kingdom)',
      'Microsoft David - English (United States)',
      'Google UK English Male',
      'Daniel',
      'Alex',
    ],
    female: [
      'Microsoft Aria Online (Natural) - English (United States)',
      'Microsoft Jenny Online (Natural) - English (United States)',
      'Microsoft Zira - English (United States)',
      'Google UK English Female',
      'Samantha',
      'Karen',
    ],
  } as Record<string, string[]>,

  /** When an avatar has no gender set. Deliberately not a gendered list. */
  preferredVoices: [
    'Google US English',
    'Microsoft Aria Online (Natural) - English (United States)',
    'Samantha',
  ],

  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,

  /** Whisper's native rate. The AudioContext resamples the mic for us. */
  sampleRate: 16000,

  /**
   * Voice activity detection.
   *
   * These are the numbers you will actually tune, and they must be tuned in the
   * real room with the real microphone — a quiet showroom and a noisy one need
   * different floors, and no default survives both.
   */
  voiceThreshold: 0.02,
  /**
   * Higher bar to interrupt her, because the speaker feeds the microphone.
   * Browser echo cancellation removes most of her voice but not all of it.
   */
  bargeInThreshold: 0.05,
  /** Ignore blips: a door, a cough, a chair. */
  minSpeechMs: 200,

  /**
   * Silence that ends a turn. Too short and she cuts off someone still
   * thinking; too long and she feels slow.
   *
   * This sits on top of transcription, so the real wait before she reacts is
   * this plus roughly a second. Budget the whole path, not this number alone.
   */
  endOfTurnSilence: 700,

  /**
   * How often to re-transcribe the audio so far, for the live transcript.
   * A partial costs most of a second of CPU, so leave headroom rather than
   * running the machine flat out for the whole time someone is talking.
   */
  partialInterval: 1200,
  /**
   * Stop re-transcribing for the caption past this much audio. Each partial
   * re-encodes the whole turn so far, so cost grows with the square of turn
   * length — and every pass queues ahead of the final one on the model lock.
   * The final transcript is never capped.
   */
  maxPartialMs: 12000,
  /** Do not let one turn grow without bound if a room is simply noisy. */
  maxUtteranceMs: 30000,
} as const
