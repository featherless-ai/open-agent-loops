/**
 * Conversation roles.
 *
 * @module
 */

/**
 * Conversation roles.
 *
 * @remarks
 * A string enum whose values are the OpenAI wire strings, so `JSON.stringify`
 * of a message still emits `"role":"user"` etc. — the wire shape is unchanged;
 * only in-code references become named constants.
 *
 * @group Messages & Events
 */
export enum Role {
  /** The system prompt role. */
  System = "system",
  /** A user turn. */
  User = "user",
  /** A model turn. */
  Assistant = "assistant",
  /** A tool-result turn. */
  Tool = "tool",
}
