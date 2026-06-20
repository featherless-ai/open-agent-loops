/**
 * A user turn.
 *
 * @module
 */

import type { ContentPart } from "./content-part";
import type { MessageBase } from "./message-base";
import { Role } from "./roles";

/**
 * A user turn.
 *
 * @remarks
 * The only role whose `content` may be multimodal: a plain `string`, or an array
 * of {@link ContentPart}s (text / image / audio / file). That mirrors the
 * chat-completions spec, where images, audio, and files are input-only and ride
 * on user turns; the array passes straight through egress to the provider.
 *
 * Abstraction over — OpenAI's `user` message (`{ role, content }`), where
 * `content` is a `string` or a {@link ContentPart} array; `timestamp` is the only
 * extension. The multimodal array crosses egress unchanged.
 *
 * @example Wire shape — plain text, then multimodal
 * ```json
 * { "role": "user", "content": "What's the weather in NYC?" }
 * ```
 * ```json
 * {
 *   "role": "user",
 *   "content": [
 *     { "type": "text", "text": "What's in this image?" },
 *     { "type": "image_url", "image_url": { "url": "https://example.com/a.png" } }
 *   ]
 * }
 * ```
 *
 * @group Messages & Events
 */
export interface UserMessage extends MessageBase {
  /** Discriminant: a user turn. */
  role: Role.User;
  /** Plain text, or a multimodal {@link ContentPart} array. */
  content: string | ContentPart[];
}

/**
 * Construct a {@link UserMessage} — pins the `role` discriminant and stamps
 * `timestamp` with the construction time; you supply the rest (`content`, and a
 * `timestamp` of your own to override the default).
 *
 * @param fields - Everything but `role`.
 * @group Messages & Events
 */
export function userMessage(fields: Omit<UserMessage, "role">): UserMessage {
  return { role: Role.User, timestamp: Date.now(), ...fields };
}
