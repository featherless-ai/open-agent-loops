/**
 * A system-prompt turn.
 *
 * @module
 */

import type { MessageBase } from "./message-base";
import { Role } from "./roles";

/**
 * A system-prompt turn.
 *
 * @remarks
 * This loop usually passes the system prompt as `ModelRequest.system` rather than
 * as a message, but the role is modeled for completeness and for histories that
 * carry one inline.
 *
 * Abstraction over — OpenAI's `system` message (`{ role, content }`); `timestamp`
 * is the only extension. Whether sent inline or as `ModelRequest.system`, it
 * serializes to the same two fields on the wire.
 *
 * @example Wire shape (OpenAI chat-completions)
 * ```json
 * { "role": "system", "content": "You are a helpful assistant." }
 * ```
 *
 * @group Messages & Events
 */
export interface SystemMessage extends MessageBase {
  /** Discriminant: the system-prompt turn. */
  role: Role.System;
  /** A system prompt is always plain text (narrows the multimodal base). */
  content: string;
}

/**
 * Construct a {@link SystemMessage} — pins the `role` discriminant and stamps
 * `timestamp` with the construction time; you supply the rest (`content`, and a
 * `timestamp` of your own to override the default).
 *
 * @param fields - Everything but `role`.
 * @group Messages & Events
 */
export function systemMessage(fields: Omit<SystemMessage, "role">): SystemMessage {
  return { role: Role.System, timestamp: Date.now(), ...fields };
}
