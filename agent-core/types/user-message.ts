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
