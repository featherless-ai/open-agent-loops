/**
 * Fields shared by every conversation message, regardless of role.
 *
 * @module
 */

import type { ContentPart } from "./content-part";

/**
 * Fields common to every message. Each role variant — {@link UserMessage},
 * {@link SystemMessage}, {@link AssistantMessage}, {@link ToolMessage} — extends
 * this and adds its own `role` discriminant plus any role-specific fields.
 *
 * @remarks
 * `content` is the widest form here — text or multimodal parts — because the base
 * cannot be *widened* by an extending interface, only narrowed. The text-only
 * roles ({@link SystemMessage}, {@link AssistantMessage}, {@link ToolMessage})
 * pin it back to `string`; only {@link UserMessage} keeps the multimodal array,
 * which is exactly where the chat-completions spec allows images / audio / files.
 *
 * Abstraction over — no wire shape of its own: every wire message carries a
 * `role`, which the concrete variants add (see each variant's `@example`).
 * `timestamp` is a shared extension dropped at egress; the OpenAI wire has no
 * per-message timestamp.
 *
 * @group Messages & Events
 */
export interface MessageBase {
  /**
   * The turn's content: a plain text string, or — for a {@link UserMessage} —
   * an array of multimodal {@link ContentPart}s (text / image / audio / file).
   */
  content: string | ContentPart[];
  /** [extension — not in the OpenAI spec] Creation time (ms since epoch), for ordering. */
  timestamp?: number;
}
