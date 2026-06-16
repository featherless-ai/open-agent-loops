/**
 * A system-prompt turn.
 *
 * @module
 */

import type { MessageBase } from "./message-base";
import type { Role } from "./roles";

/**
 * A system-prompt turn.
 *
 * @remarks
 * This loop usually passes the system prompt as `ModelRequest.system` rather than
 * as a message, but the role is modeled for completeness and for histories that
 * carry one inline.
 *
 * @group Messages & Events
 */
export interface SystemMessage extends MessageBase {
  /** Discriminant: the system-prompt turn. */
  role: Role.System;
}
