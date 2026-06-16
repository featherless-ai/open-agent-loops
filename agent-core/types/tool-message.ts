/**
 * A tool-result turn — the response to one tool call.
 *
 * @module
 */

import type { MessageBase } from "./message-base";
import { Role } from "./roles";

/**
 * A tool-result turn — the **response to a single {@link ToolCall}**.
 *
 * @remarks
 * The loop produces exactly one `ToolMessage` per tool call the assistant made,
 * carrying that tool's output in `content`. It is linked back to the call it
 * answers by {@link ToolMessage.tool_call_id} (which equals the call's `id`), so
 * the model can tell which result belongs to which call. N tool calls in a turn
 * yield N tool messages, paired one-to-one by id.
 *
 * @see {@link ToolCall}
 * @group Messages & Events
 */
export interface ToolMessage extends MessageBase {
  /** Discriminant: a tool-result turn. */
  role: Role.Tool;

  /**
   * Standard wire field: the id of the {@link ToolCall} this message is the
   * response to — equal to that call's `id`. Always set.
   */
  tool_call_id: string;

  /**
   * [extension — not in the OpenAI spec] The function name this result answers.
   * Lets the loop route results and lets stop conditions match on tool name
   * without re-deriving it from `tool_call_id`; OpenAI tool messages omit it.
   */
  toolName?: string;

  /**
   * [extension — not in the OpenAI spec] Marks a tool result as an error, so
   * hooks and UIs can treat a failed call differently from a normal one. Set by
   * the loop when a tool throws (see `Tool.execute`); the wire format carries
   * only plain `content`.
   */
  isError?: boolean;
}

/**
 * Construct a {@link ToolMessage} — pins the `role` discriminant and stamps
 * `timestamp` with the construction time; you supply the rest. `tool_call_id`
 * stays required (the message is meaningless without the call it answers);
 * `toolName`, `isError`, and an overriding `timestamp` are optional.
 *
 * @param fields - Everything but `role`.
 * @group Messages & Events
 */
export function toolMessage(fields: Omit<ToolMessage, "role">): ToolMessage {
  return { role: Role.Tool, timestamp: Date.now(), ...fields };
}
