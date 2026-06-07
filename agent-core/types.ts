/**
 * Core message vocabulary shared across the agent loop, memory, and model
 * client. Intentionally provider-agnostic: nothing here references a specific
 * LLM SDK so that every seam (model, memory, tools) stays swappable.
 */

export type Role = "system" | "user" | "assistant" | "tool";

/** A tool invocation requested by the model. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * A single conversation message. One shape covers user/assistant/tool turns:
 * - assistant turns may carry `reasoning` and/or `toolCalls`
 * - tool-result turns set `toolCallId` / `toolName` / `isError`
 */
export interface Message {
  role: Role;
  content: string;
  /**
   * The model's reasoning / chain-of-thought for this turn — a channel
   * distinct from `content`. Set on assistant turns from reasoning models.
   * Providers expose it as `reasoning` (current vLLM / OpenAI-style) or
   * `reasoning_content` (DeepSeek's first-party API, legacy vLLM).
   *
   * Provider-agnostic: this holds whatever reasoning channel a model emits.
   * Models known to emit one (via a vLLM reasoning parser or a native API):
   *   - DeepSeek  R1, V3.1, V4 (thinking mode; off by default on V3.1)
   *   - Qwen3     series
   *   - GLM       4.5 series
   *   - others    IBM Granite 3.2, Hunyuan A13B, MiniMax-M2, ERNIE-4.5,
   *               Cohere Command A, Gemma, Holo2
   *
   * Persisted, not transient, because resend rules depend on the turn:
   * - turn HAS `toolCalls`  → reasoning MUST be resent on later turns, or
   *   thinking-mode models (e.g. DeepSeek V4) reject the request with a 400.
   * - turn has NO tool calls → reasoning is display/memory only and is
   *   dropped when building the next request (the model ignores it).
   * The request builder (prepareRequestMessages) applies this; storage just
   * keeps the value.
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
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  timestamp?: number;
}

/** Events emitted by the loop for observability / streaming to a UI. */
export type AgentEvent =
  | { type: "agent_start"; sessionId: string }
  | { type: "turn_start"; step: number }
  | { type: "reasoning_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "message"; message: Message }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | {
      type: "tool_end";
      toolCallId: string;
      toolName: string;
      result: string;
      isError: boolean;
    }
  | { type: "agent_end"; messages: Message[]; steps: number };

export type EventSink = (event: AgentEvent) => void | Promise<void>;
