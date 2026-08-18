/**
 * The AI Provider seam.
 *
 * The Conversation Engine must not know that Claude exists. It calls stream()
 * and receives text — swapping Claude for Gemini, OpenAI or an offline model is
 * a change here and in `backend/llm.py`, and nowhere else.
 *
 * Conversation history lives server-side in `backend/memory.py`, so only the new
 * message crosses the wire. Keeping a second copy in the browser would be two
 * sources of truth for one conversation.
 */
export interface AiProvider {
  /**
   * `context` is what is currently on screen. Without it "is that good for
   * gaming?" reaches the model with no idea what "that" refers to.
   */
  stream(message: string, signal: AbortSignal, context?: string): AsyncIterable<string>
}
