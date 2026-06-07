/**
 * Core message vocabulary shared across the agent loop, memory, and model
 * client. Intentionally provider-agnostic: nothing here references a specific
 * LLM SDK so that every seam (model, memory, tools) stays swappable.
 */

/**
 * Conversation roles. A string enum whose values are the OpenAI wire strings, so
 * `JSON.stringify` of a message still emits `"role":"user"` etc. — the wire shape
 * is unchanged; only in-code references become named constants.
 */
export enum Role {
  System = "system",
  User = "user",
  Assistant = "assistant",
  Tool = "tool",
}

/**
 * A tool invocation requested by the model — the OpenAI chat-completions wire
 * shape verbatim: `{ id, type, function: { name, arguments } }`, where
 * `arguments` is a JSON *string* (not a parsed object). The loop JSON-parses
 * and schema-validates it before the tool runs.
 */
/**
 * The kind of tool call. The OpenAI chat-completions format defines exactly one
 * value, `"function"`; a single-member string enum keeps the call sites named
 * while serializing to that same wire string.
 */
export enum ToolCallType {
  Function = "function",
}

export interface ToolCall {
  id: string;
  type: ToolCallType.Function;
  function: {
    name: string;
    /** Arguments as a JSON string, exactly as the model emitted them. */
    arguments: string;
  };
}

/**
 * Tool-call arguments *parsed* into an object — the form handed off to
 * observers, hooks, and the gate (the wire form on `ToolCall.function.arguments`
 * is a JSON string). Always an object: function-calling schemas are JSON Schema
 * objects, so parsed arguments are keyed values. The value types aren't known at
 * the loop level (each tool has its own schema), hence `unknown` per key — a
 * tool's own `execute` gets them fully typed as `z.infer<schema>`.
 */
export type ToolArguments = Record<string, unknown>;

/**
 * A single conversation message. The base shape mirrors the OpenAI
 * chat-completions message format (`role`, `content`, `tool_calls`,
 * `tool_call_id`); the remaining fields are EXTENSIONS — not in that spec, but
 * kept deliberately for agent engineering (`reasoning`, `toolName`, `isError`,
 * `timestamp`), each marked below. One shape covers user/assistant/tool turns:
 * - assistant turns may carry `reasoning` and/or `tool_calls`
 * - tool-result turns set `tool_call_id` / `toolName` / `isError`
 */
export interface Message {
  role: Role;
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

/**
 * Discriminant tags for {@link AgentEvent}. A string enum: each member's value
 * is the wire string it replaces, so serialized events (JSON to a UI, logs) are
 * byte-for-byte unchanged — only the in-code references become named constants.
 */
export enum AgentEventType {
  AgentStart = "agent_start",
  TurnStart = "turn_start",
  ReasoningDelta = "reasoning_delta",
  TextDelta = "text_delta",
  Message = "message",
  ToolStart = "tool_start",
  ToolEnd = "tool_end",
  AgentEnd = "agent_end",
}

/**
 * The payload of an event, minus the timestamp. The loop's call sites construct
 * these; `emit` stamps each one centrally on the way out (see {@link AgentEvent}),
 * so no call site has to remember to set the time.
 */
export type AgentEventBody =
  | { type: AgentEventType.AgentStart; sessionId: string }
  | { type: AgentEventType.TurnStart; step: number }
  | { type: AgentEventType.ReasoningDelta; text: string }
  | { type: AgentEventType.TextDelta; text: string }
  | { type: AgentEventType.Message; message: Message }
  | { type: AgentEventType.ToolStart; toolCallId: string; toolName: string; args: ToolArguments }
  | {
      type: AgentEventType.ToolEnd;
      toolCallId: string;
      toolName: string;
      result: string;
      isError: boolean;
    }
  | { type: AgentEventType.AgentEnd; messages: Message[]; steps: number };

/**
 * An event emitted by the loop for observability / streaming to a UI. Every
 * event carries a `timestamp` (ms since epoch) stamped at emit time, so a
 * consumer can measure latency between turns, tokens, and tool calls. The
 * intersection still discriminates on `type` exactly like the body union does.
 */
export type AgentEvent = AgentEventBody & { timestamp: number };

export type EventSink = (event: AgentEvent) => void | Promise<void>;
