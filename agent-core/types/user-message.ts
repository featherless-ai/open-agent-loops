/**
 * A user turn.
 *
 * @module
 */

import type { MessageBase } from "./message-base";
import type { Role } from "./roles";

/**
 * A user turn.
 *
 * @group Messages & Events
 */
export interface UserMessage extends MessageBase {
  /** Discriminant: a user turn. */
  role: Role.User;
}
