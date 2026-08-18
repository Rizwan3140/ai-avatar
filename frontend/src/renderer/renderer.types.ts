import type { Emotion } from '../bus/events.ts'

/**
 * The Digital Human Renderer contract.
 *
 * The rest of the system depends on this, never on how she is drawn. MP4
 * crossfading is the v1 implementation; LivePortrait, MuseTalk, Audio2Face,
 * HeyGen or Tavus can replace it without any other module changing.
 *
 * Nothing outside renderer/ writes a style. Conversation manipulating CSS is a
 * bug, not a shortcut.
 */
export interface DigitalHumanRenderer {
  /** Resolve only when she is genuinely ready to be seen. */
  initialize(): Promise<void>
  idle(): void
  listen(): void
  think(): void
  speak(): void
  /** Leave presence entirely — sleep. */
  stop(): void
  setEmotion(emotion: Emotion): void
}

/** The visible poses. Maps 1:1 to a clip in the MP4 implementation. */
export type Pose = 'idle' | 'listen' | 'think' | 'speak'
