/**
 * A model (assistant) turn.
 *
 * @module
 */

import type { FinishReason } from "./finish-reason";
import type { MessageBase } from "./message-base";
import type { ReasoningDetail } from "./reasoning";
import { Role } from "./roles";
import type { ToolCall } from "./tool-calls";

/**
 * A model (assistant) turn.
 *
 * @remarks
 * May carry `reasoning` (+ its verbatim `reasoning_details`), a `finishReason`,
 * and `tool_calls`. {@link AssistantMessage.isError} marks a turn whose *stream*
 * failed (a blank or truncated completion) — distinct from a tool failure, which
 * lands on a {@link ToolMessage}.
 *
 * @group Messages & Events
 */
export interface AssistantMessage extends MessageBase {
  /** Discriminant: a model turn. */
  role: Role.Assistant;

  /**
   * The model's reasoning / chain-of-thought for this turn — a channel distinct
   * from `content`, set on assistant turns from reasoning models.
   *
   * A deliberate, NON-STANDARD extension to the OpenAI chat-completions format.
   * That standard covers text + tool calls; reasoning is an addition every
   * reasoning provider bolts on under its own field name — `reasoning` (current
   * vLLM / OpenAI-style) or `reasoning_content` (DeepSeek's first-party API,
   * legacy vLLM).
   *
   * Provider-agnostic: this holds whatever reasoning channel a model emits.
   * Models known to emit one (via a vLLM reasoning parser or a native API):
   *   - DeepSeek  R1, V3.1, V4 (thinking mode; off by default on V3.1)
   *   - Qwen3     series
   *   - GLM       4.5 series
   *   - others    IBM Granite 3.2, Hunyuan A13B, MiniMax-M2, ERNIE-4.5,
   *               Cohere Command A, Gemma, Holo2
   *
   * Persisted, not transient, because resend rules depend on the turn (the same
   * rule governs {@link AssistantMessage.reasoning_details}):
   * - turn HAS `tool_calls`  → reasoning MUST be resent on later turns, or
   *   thinking-mode models (e.g. DeepSeek V4) reject the request with a 400.
   * - turn has NO tool calls → reasoning is display/memory only and is dropped
   *   when building the next request (the model ignores it).
   * The request builder (prepareRequestMessages) applies this to both the flat
   * string and the structured blocks; storage just keeps the value.
   *
   * Sources of truth — these rules live in provider docs, not here:
   *   - vLLM, field naming + parser registry (reasoning vs reasoning_content):
   *     https://docs.vllm.ai/en/latest/features/reasoning_outputs/
   *   - DeepSeek thinking mode, tool-call resend / 400-if-omitted:
   *     https://api-docs.deepseek.com/guides/thinking_mode
   *   - DeepSeek R1, older rule (reasoning_content rejected in input):
   *     https://api-docs.deepseek.com/guides/reasoning_model
   *   - Anthropic interleaved thinking, preserve thinking blocks across tool
   *     calls: https://docs.claude.com/en/docs/build-with-claude/extended-thinking
   *   - OpenAI reasoning, summaries + Responses API:
   *     https://platform.openai.com/docs/guides/reasoning
   */
  reasoning?: string;

  /**
   * [extension — not in the OpenAI spec] The structured, VERBATIM form of this
   * turn's reasoning: signed / summarized / encrypted blocks, as emitted by
   * aggregators for Anthropic, Gemini, and OpenAI o-series models.
   *
   * Present alongside {@link AssistantMessage.reasoning} only when the provider
   * sends structured blocks; raw-string reasoning models leave it unset. The flat
   * `reasoning` string is the human-readable view; this is the source of truth
   * for round-tripping and MUST be resent unchanged and in original order on
   * tool-call turns (see {@link ReasoningDetail} for the immutability contract,
   * and {@link AssistantMessage.reasoning} for the conditional-resend rule that
   * applies identically to both fields).
   *
   * @see {@link ReasoningDetail}
   */
  reasoning_details?: ReasoningDetail[];

  /**
   * [extension — not in the OpenAI spec field set, but a standard wire value]
   * Why this assistant turn ended ({@link FinishReason}). Recorded so callers and
   * stop conditions can distinguish a clean `stop` from a truncated `length` or a
   * `content_filter` withholding — a turn with no tool calls is otherwise
   * indistinguishable from a complete answer. Unset when the provider reports none.
   *
   * @see {@link FinishReason}
   */
  finishReason?: FinishReason;

  /** Standard wire field: tool calls the assistant wants to make. */
  tool_calls?: ToolCall[];

  /**
   * [extension — not in the OpenAI spec] Marks a turn whose stream failed (e.g. a
   * blank or truncated completion surfaced as an error), so hooks and UIs can
   * treat it differently. A *tool* failure is marked on a {@link ToolMessage}
   * instead; the wire format carries only plain `content`.
   */
  isError?: boolean;
}

/**
 * Construct an {@link AssistantMessage} — pins the `role` discriminant and
 * stamps `timestamp` with the construction time; you supply the rest. Everything
 * but `content` is optional (`reasoning`, `reasoning_details`, `finishReason`,
 * `tool_calls`, `isError`, and an overriding `timestamp`).
 *
 * @param fields - Everything but `role`.
 * @group Messages & Events
 */
export function assistantMessage(fields: Omit<AssistantMessage, "role">): AssistantMessage {
  return { role: Role.Assistant, timestamp: Date.now(), ...fields };
}
