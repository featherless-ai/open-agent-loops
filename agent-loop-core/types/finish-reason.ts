/**
 * Why a model turn ended — the wire `finish_reason` from the provider.
 *
 * @module
 */

/**
 * Why a model turn ended — the wire `finish_reason` from the provider.
 *
 * @remarks
 * Part of the OpenAI chat-completions contract, surfaced here so the loop and
 * callers can tell a *clean* finish apart from a degraded one rather than
 * treating "no tool calls" as a blanket "done":
 * - {@link FinishReason.Stop | stop} — the model finished on its own; a final answer.
 * - {@link FinishReason.ToolCalls | tool_calls} — the model wants tools run; the loop continues.
 * - {@link FinishReason.Length | length} — output hit the token cap and was TRUNCATED;
 *   the turn is incomplete, not a real answer.
 * - {@link FinishReason.ContentFilter | content_filter} — the provider withheld content.
 *
 * The loop still drives continuation off the presence of tool calls (the two
 * agree in practice); this value is recorded on the assistant turn so truncation
 * and filtering are observable instead of silently passing as success.
 *
 * @group Messages & Events
 */
export enum FinishReason {
  /** The model stopped on its own — a complete final answer. */
  Stop = "stop",
  /** The model wants one or more tools run before it can continue. */
  ToolCalls = "tool_calls",
  /** Output hit the max-tokens cap and was truncated mid-turn (incomplete). */
  Length = "length",
  /** The provider's content filter withheld part or all of the output. */
  ContentFilter = "content_filter",
}
