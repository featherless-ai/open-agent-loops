/**
 * A user turn.
 *
 * @module
 */

import type { MessageBase } from "./message-base";
import { Role } from "./roles";

/**
 * A user turn.
 *
 * @group Messages & Events
 */
export interface UserMessage extends MessageBase {
  /** Discriminant: a user turn. */
  role: Role.User;
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
