/**
 * Core message vocabulary shared across the agent loop, memory, and model
 * client. Intentionally provider-agnostic: nothing here references a specific
 * LLM SDK so that every seam (model, memory, tools) stays swappable.
 *
 * @module
 */

/**
 * Conversation roles.
 *
 * @remarks
 * A string enum whose values are the OpenAI wire strings, so `JSON.stringify`
 * of a message still emits `"role":"user"` etc. — the wire shape is unchanged;
 * only in-code references become named constants.
 *
 * @group Messages & Events
 */
export enum Role {
  /** The system prompt role. */
  System = "system",
  /** A user turn. */
  User = "user",
  /** A model turn. */
  Assistant = "assistant",
  /** A tool-result turn. */
  Tool = "tool",
}

/**
 * The kind of tool call.
 *
 * @remarks
 * The OpenAI chat-completions format defines exactly one value, `"function"`; a
 * single-member string enum keeps the call sites named while serializing to
 * that same wire string.
 *
 * @group Messages & Events
 */
export enum ToolCallType {
  /** A function tool call — the only kind the wire format defines. */
  Function = "function",
}

/**
 * A tool invocation requested by the model.
 *
 * @remarks
 * The OpenAI chat-completions wire shape verbatim: `{ id, type, function: {
 * name, arguments } }`, where `arguments` is a JSON *string* (not a parsed
 * object). The loop JSON-parses and schema-validates it before the tool runs.
 *
 * @see {@link ToolArguments}
 * @group Messages & Events
 */
export interface ToolCall {
  /** Unique id for this call, used to match the answering tool result. */
  id: string;
  /** The call kind; always {@link ToolCallType.Function}. */
  type: ToolCallType.Function;
  /** The function name and its raw argument string. */
  function: {
    /** Name of the tool/function to invoke. */
    name: string;
    /** Arguments as a JSON string, exactly as the model emitted them. */
    arguments: string;
  };
}

/**
 * Tool-call arguments *parsed* into an object.
 *
 * @remarks
 * The form handed off to observers, hooks, and the gate (the wire form on
 * {@link ToolCall.function | ToolCall.function.arguments} is a JSON string).
 * Always an object: function-calling schemas are JSON Schema objects, so parsed
 * arguments are keyed values. The value types aren't known at the loop level
 * (each tool has its own schema), hence `unknown` per key — a tool's own
 * `execute` gets them fully typed as `z.infer<schema>`.
 *
 * @group Messages & Events
 */
export type ToolArguments = Record<string, unknown>;

/**
 * A single conversation message.
 *
 * @remarks
 * The base shape mirrors the OpenAI chat-completions message format (`role`,
 * `content`, `tool_calls`, `tool_call_id`); the remaining fields are EXTENSIONS
 * — not in that spec, but kept deliberately for agent engineering (`reasoning`,
 * `toolName`, `isError`, `timestamp`), each marked below. One shape covers
 * user/assistant/tool turns:
 * - assistant turns may carry `reasoning` and/or `tool_calls`
 * - tool-result turns set `tool_call_id` / `toolName` / `isError`
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
 * Discriminant tags for {@link AgentEvent}.
 *
 * @remarks
 * A string enum: each member's value is the wire string it replaces, so
 * serialized events (JSON to a UI, logs) are byte-for-byte unchanged — only the
 * in-code references become named constants.
 *
 * @group Messages & Events
 */
export enum AgentEventType {
  /** The run has started. */
  AgentStart = "agent_start",
  /** A new model turn has started. */
  TurnStart = "turn_start",
  /** A partial chunk of the assistant's reasoning channel. */
  ReasoningDelta = "reasoning_delta",
  /** A partial chunk of the assistant's text content. */
  TextDelta = "text_delta",
  /** A complete message was added to the conversation. */
  Message = "message",
  /** A tool call is about to execute. */
  ToolStart = "tool_start",
  /** A tool call finished, carrying its result. */
  ToolEnd = "tool_end",
  /** The run has ended. */
  AgentEnd = "agent_end",
}

/**
 * The payload of an event, minus the timestamp.
 *
 * @remarks
 * The loop's call sites construct these; `emit` stamps each one centrally on the
 * way out (see {@link AgentEvent}), so no call site has to remember to set the
 * time.
 *
 * @group Messages & Events
 */
export type AgentEventBody =
  | {
      /** Discriminant; see {@link AgentEventType.AgentStart}. */
      type: AgentEventType.AgentStart;
      /** The session whose run is starting. */
      sessionId: string;
    }
  | {
      /** Discriminant; see {@link AgentEventType.TurnStart}. */
      type: AgentEventType.TurnStart;
      /** 1-based index of the model turn that is starting. */
      step: number;
    }
  | {
      /** Discriminant; see {@link AgentEventType.ReasoningDelta}. */
      type: AgentEventType.ReasoningDelta;
      /** A chunk of the assistant's reasoning channel. */
      text: string;
    }
  | {
      /** Discriminant; see {@link AgentEventType.TextDelta}. */
      type: AgentEventType.TextDelta;
      /** A chunk of the assistant's text content. */
      text: string;
    }
  | {
      /** Discriminant; see {@link AgentEventType.Message}. */
      type: AgentEventType.Message;
      /** The complete message that was appended to the conversation. */
      message: Message;
    }
  | {
      /** Discriminant; see {@link AgentEventType.ToolStart}. */
      type: AgentEventType.ToolStart;
      /** Id of the tool call about to run, matching its {@link AgentEventType.ToolEnd} event. */
      toolCallId: string;
      /** Name of the tool about to run. */
      toolName: string;
      /** The parsed arguments the tool will receive. */
      args: ToolArguments;
    }
  | {
      /** Discriminant; see {@link AgentEventType.ToolEnd}. */
      type: AgentEventType.ToolEnd;
      /** Id of the finished tool call, matching its {@link AgentEventType.ToolStart} event. */
      toolCallId: string;
      /** Name of the tool that ran. */
      toolName: string;
      /** The tool result text folded back into the conversation. */
      result: string;
      /** Whether the tool reported an error. */
      isError: boolean;
    }
  | {
      /** Discriminant; see {@link AgentEventType.AgentEnd}. */
      type: AgentEventType.AgentEnd;
      /** The full conversation as of run end. */
      messages: Message[];
      /** Total number of model turns the run took. */
      steps: number;
    };

/**
 * An event emitted by the loop for observability / streaming to a UI.
 *
 * @remarks
 * Every event carries a `timestamp` (ms since epoch) stamped at emit time, so a
 * consumer can measure latency between turns, tokens, and tool calls. The
 * intersection still discriminates on `type` exactly like the body union does.
 *
 * @see {@link AgentEventBody}
 * @see {@link EventSink}
 * @group Messages & Events
 */
export type AgentEvent = AgentEventBody & {
  /** Emit time in ms since the epoch, stamped centrally as the event goes out. */
  timestamp: number;
};

/**
 * Consumer callback for {@link AgentEvent}s emitted during a run.
 *
 * @group Messages & Events
 */
export type EventSink = (event: AgentEvent) => void | Promise<void>;
