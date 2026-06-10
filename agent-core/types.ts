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

/**
 * Provider dialect a {@link ReasoningDetail} block is encoded in.
 *
 * @remarks
 * Carried verbatim and used only to pick the right egress field — never parsed
 * by this library. `anthropic-claude-v1` is the default for unlabeled blocks.
 * Unknown future dialects map to {@link ReasoningFormat.Unknown}.
 *
 * @group Messages & Events
 */
export enum ReasoningFormat {
  /** Dialect not advertised by the provider. */
  Unknown = "unknown",
  /** OpenAI Responses API reasoning items. */
  OpenAIResponsesV1 = "openai-responses-v1",
  /** Azure OpenAI Responses API reasoning items. */
  AzureOpenAIResponsesV1 = "azure-openai-responses-v1",
  /** xAI Responses API reasoning items. */
  XAIResponsesV1 = "xai-responses-v1",
  /** Anthropic Claude reasoning blocks — the default for unlabeled blocks. */
  AnthropicClaudeV1 = "anthropic-claude-v1",
  /** Google Gemini reasoning blocks (thought signatures). */
  GoogleGeminiV1 = "google-gemini-v1",
}

/**
 * One structured reasoning block, preserved VERBATIM for replay.
 *
 * @remarks
 * The richer counterpart to the flat {@link Message.reasoning} string: the form
 * aggregators (OpenRouter and similar) use for models whose chain-of-thought is
 * signed, summarized, or encrypted (Anthropic, Gemini, OpenAI o-series). A turn
 * may carry several blocks; their relative order and {@link ReasoningDetailBase.index | index}
 * are load-bearing.
 *
 * IMMUTABILITY CONTRACT — these blocks are pass-through-verbatim. A
 * `reasoning.text` block's {@link ReasoningTextDetail.signature | signature} and a
 * {@link ReasoningEncryptedDetail.data | reasoning.encrypted} blob are validated
 * by the model; editing, reordering, merging, splitting, or dropping any block
 * invalidates the sequence (e.g. Gemini rejects a tool call whose thought
 * signature is missing with a 400). Consumers that inspect reasoning may read the
 * flattened {@link Message.reasoning} text, but must resend `reasoning_details`
 * unchanged and in original order.
 *
 * @see {@link Message.reasoning_details}
 * @group Messages & Events
 */
export interface ReasoningDetailBase {
  /** Provider-assigned block id, or `null` when the provider sends none. */
  id: string | null;
  /** The dialect this block is encoded in; see {@link ReasoningFormat}. */
  format: ReasoningFormat;
  /**
   * Sequence position within the turn's reasoning. Load-bearing: it drives
   * streaming reassembly and fixes the order blocks must be resent in.
   */
  index?: number;
}

/**
 * A plaintext (optionally signed) reasoning block.
 *
 * @remarks
 * When {@link ReasoningTextDetail.signature | signature} is present the `text` is
 * signature-protected — treat the whole block as immutable.
 *
 * @group Messages & Events
 */
export interface ReasoningTextDetail extends ReasoningDetailBase {
  /** Discriminant. */
  type: "reasoning.text";
  /** The reasoning text. */
  text: string;
  /** Provider signature over the text; when set, the block is immutable. */
  signature?: string | null;
}

/**
 * A provider-summarized reasoning block (the raw chain-of-thought is withheld).
 *
 * @group Messages & Events
 */
export interface ReasoningSummaryDetail extends ReasoningDetailBase {
  /** Discriminant. */
  type: "reasoning.summary";
  /** The provider's summary of the hidden reasoning. */
  summary: string;
}

/**
 * An encrypted reasoning block — opaque ciphertext, never decoded by this library.
 *
 * @group Messages & Events
 */
export interface ReasoningEncryptedDetail extends ReasoningDetailBase {
  /** Discriminant. */
  type: "reasoning.encrypted";
  /** Opaque encrypted payload; pass-through only. May stream as `[REDACTED]`. */
  data: string;
}

/**
 * A structured reasoning block in one of its three shapes.
 *
 * @remarks
 * Discriminated on `type`. See {@link ReasoningDetailBase} for the immutability
 * contract that governs all three.
 *
 * @group Messages & Events
 */
export type ReasoningDetail =
  | ReasoningTextDetail
  | ReasoningSummaryDetail
  | ReasoningEncryptedDetail;

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
