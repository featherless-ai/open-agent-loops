/**
 * The single LLM boundary. The loop never talks to a provider directly — it
 * only depends on `ModelClient`, so any backend (mock, OpenAI-compatible,
 * Anthropic, raw fetch) can be plugged in by implementing this one interface.
 *
 * Streaming is the default contract: `stream()` returns an async iterable of
 * incremental events. A non-streaming model is just a streaming model that
 * happens to emit a single chunk.
 *
 * @module
 */

import type { AssistantMessage, FinishReason, Message, ToolCall } from "./types";

/**
 * Tool description handed to the model so it knows what it can call.
 *
 * @group Model
 */
export interface ToolSpec {
  /** Tool/function name the model calls. */
  name: string;
  /** Human-readable description guiding when the model should call it. */
  description: string;
  /** JSON Schema describing the tool arguments. */
  parameters: unknown;
}

/**
 * Everything the model needs to produce the next assistant turn.
 *
 * @group Model
 */
export interface ModelRequest {
  /** Optional system prompt. */
  system?: string;
  /** The conversation history to continue from. */
  messages: Message[];
  /** Tools the model may call this turn, if any. */
  tools?: ToolSpec[];
  /** Optional signal to cancel the in-flight request. */
  signal?: AbortSignal;
}

/**
 * Discriminant tags for {@link StreamEvent}.
 *
 * @remarks
 * A string enum whose values are the wire strings they replace, so nothing
 * about the emitted events changes on the wire — only in-code references become
 * named constants.
 *
 * @group Model
 */
export enum StreamEventType {
  /** Partial chain-of-thought (provider field `reasoning` / `reasoning_content`). */
  ReasoningDelta = "reasoning_delta",
  /** Partial assistant text (streamed token-by-token / chunked). */
  TextDelta = "text_delta",
  /** A fully-formed tool invocation the model wants to make. */
  ToolCall = "tool_call",
  /** Terminal event carrying the assembled assistant message. */
  Done = "done",
  /** The model failed; `message` holds whatever was assembled. */
  Error = "error",
}

/**
 * Incremental output from the model.
 *
 * @remarks
 * See {@link StreamEventType} for each tag.
 *
 * @group Model
 */
export type StreamEvent =
  | {
      /** Discriminant; see {@link StreamEventType.ReasoningDelta}. */
      type: StreamEventType.ReasoningDelta;
      /** A chunk of the model's reasoning channel. */
      text: string;
    }
  | {
      /** Discriminant; see {@link StreamEventType.TextDelta}. */
      type: StreamEventType.TextDelta;
      /** A chunk of the model's text content. */
      text: string;
    }
  | {
      /** Discriminant; see {@link StreamEventType.ToolCall}. */
      type: StreamEventType.ToolCall;
      /** The fully-formed tool invocation the model wants to make. */
      toolCall: ToolCall;
    }
  | {
      /** Discriminant; see {@link StreamEventType.Done}. */
      type: StreamEventType.Done;
      /**
       * The assembled assistant message for the turn. Carries the verbatim
       * `reasoning_details` (when the provider streamed structured blocks) and
       * the `finishReason`, both reassembled from the stream.
       */
      message: AssistantMessage;
      /**
       * Why the turn ended, when the provider reported it. The same value is
       * mirrored onto {@link Message.finishReason}; it is surfaced on the event
       * too so a consumer reading the stream need not wait to inspect the message.
       */
      finishReason?: FinishReason;
    }
  | {
      /** Discriminant; see {@link StreamEventType.Error}. */
      type: StreamEventType.Error;
      /** The failure that ended the turn. */
      error: Error;
      /** Whatever assistant message was assembled before the failure. */
      message: AssistantMessage;
    };

/**
 * A live model response: async-iterable of events.
 *
 * @see {@link StreamEvent}
 * @group Model
 */
export type ModelStream = AsyncIterable<StreamEvent>;

/**
 * The single LLM boundary the loop depends on.
 *
 * @remarks
 * The loop never talks to a provider directly — it only depends on this
 * interface, so any backend (mock, OpenAI-compatible, Anthropic, raw fetch) can
 * be plugged in by implementing {@link ModelClient.stream | stream}.
 *
 * @example
 * ```ts
 * const echo: ModelClient = {
 *   async *stream(request) {
 *     const message: AssistantMessage = { role: Role.Assistant, content: "hi" };
 *     yield { type: StreamEventType.TextDelta, text: "hi" };
 *     yield { type: StreamEventType.Done, message };
 *   },
 * };
 * ```
 * @group Model
 */
export interface ModelClient {
  /**
   * Begin a streaming completion. Implementations MUST stream by default.
   *
   * @param request - The system prompt, history, and tools for this turn.
   * @returns An async iterable of {@link StreamEvent}s for the assistant turn.
   */
  stream(request: ModelRequest): ModelStream;
}
