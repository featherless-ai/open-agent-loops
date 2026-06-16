/**
 * The single conversation message shape, shared across the agent loop, memory,
 * and model client.
 *
 * @module
 */

import type { FinishReason } from "./finish-reason";
import type { ReasoningDetail } from "./reasoning";
import type { Role } from "./roles";
import type { ToolCall } from "./tool-calls";

/**
 * A single conversation message.
 *
 * @remarks
 * The base shape mirrors the OpenAI chat-completions message format (`role`,
 * `content`, `tool_calls`, `tool_call_id`); the remaining fields are EXTENSIONS
 * — not in that spec, but kept deliberately for agent engineering (`reasoning`,
 * `toolName`, `isError`, `timestamp`), each marked below. One shape covers
 * user/assistant/tool turns:
 * - assistant turns may carry `reasoning` (+ optional `reasoning_details`),
 *   `finishReason`, and/or `tool_calls`
 * - tool-result turns set `tool_call_id` / `toolName` / `isError`
 *
 * Reasoning has two representations that travel together: the flat
 * {@link Message.reasoning} string (for inspection/display) and, when the
 * provider sends structured blocks, {@link Message.reasoning_details} (preserved
 * verbatim for replay). The same conditional-resend rule governs BOTH — see
 * {@link Message.reasoning}.
 *
 * @group Messages & Events
 */
export interface Message {
  /** The turn's role. */
  role: Role;
  /** The turn's text content. */
  content: string;
  /**
   * The model's reasoning / chain-of-thought for this turn — a channel
   * distinct from `content`, set on assistant turns from reasoning models.
   *
   * A deliberate, NON-STANDARD extension to the OpenAI chat-completions
   * format. That standard covers text + tool calls; reasoning is an addition
   * every reasoning provider bolts on under its own field name — `reasoning`
   * (current vLLM / OpenAI-style) or `reasoning_content` (DeepSeek's
   * first-party API, legacy vLLM). Adding a field on top of the standard is
   * normal and expected; it's called out here so the divergence is explicit
   * rather than hidden.
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
   * rule governs {@link Message.reasoning_details}):
   * - turn HAS `toolCalls`  → reasoning MUST be resent on later turns, or
   *   thinking-mode models (e.g. DeepSeek V4) reject the request with a 400.
   * - turn has NO tool calls → reasoning is display/memory only and is
   *   dropped when building the next request (the model ignores it).
   * The request builder (prepareRequestMessages) applies this to both the flat
   * string and the structured blocks; storage just keeps the value.
   *
   * Sources of truth — these rules live in provider docs, not here:
   *   - vLLM, field naming + parser registry (reasoning vs reasoning_content,
   *     which models): https://docs.vllm.ai/en/latest/features/reasoning_outputs/
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
   * Present alongside {@link Message.reasoning} only when the provider sends
   * structured blocks; raw-string reasoning models leave it unset. The flat
   * `reasoning` string is the human-readable view; this is the source of truth
   * for round-tripping and MUST be resent unchanged and in original order on
   * tool-call turns (see {@link ReasoningDetail} for the immutability contract,
   * and {@link Message.reasoning} for the conditional-resend rule that applies
   * identically to both fields).
   *
   * @see {@link ReasoningDetail}
   */
  reasoning_details?: ReasoningDetail[];

  /**
   * [extension — not in the OpenAI spec field set, but a standard wire value]
   * Why this assistant turn ended ({@link FinishReason}). Recorded so callers and
   * stop conditions can distinguish a clean `stop` from a truncated `length` or a
   * `content_filter` withholding — a turn with no tool calls is otherwise
   * indistinguishable from a complete answer. Unset on non-model turns and when
   * the provider reports none.
   *
   * @see {@link FinishReason}
   */
  finishReason?: FinishReason;

  /** Standard wire field: tool calls the assistant wants to make (assistant turns). */
  tool_calls?: ToolCall[];
  /** Standard wire field: the id of the tool call a tool-role message answers (tool turns). */
  tool_call_id?: string;

  /**
   * [extension — not in the OpenAI spec] The function name a tool-role message
   * answers. Lets the loop route results and lets stop conditions match on tool
   * name without re-deriving it from `tool_call_id`; OpenAI tool messages omit it.
   */
  toolName?: string;
  /**
   * [extension — not in the OpenAI spec] Marks a tool result as an error, so
   * hooks and UIs can treat a failed call differently from a normal one; the
   * wire format carries only plain `content`.
   */
  isError?: boolean;
  /** [extension — not in the OpenAI spec] Creation time (ms since epoch), for ordering. */
  timestamp?: number;
}
