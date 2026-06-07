/**
 * The single LLM boundary. The loop never talks to a provider directly — it
 * only depends on `ModelClient`, so any backend (mock, OpenAI-compatible,
 * Anthropic, raw fetch) can be plugged in by implementing this one interface.
 *
 * Streaming is the default contract: `stream()` returns an async iterable of
 * incremental events. A non-streaming model is just a streaming model that
 * happens to emit a single chunk.
 */

import type { Message, ToolCall } from "./types";

/** Tool description handed to the model so it knows what it can call. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema describing the tool arguments. */
  parameters: unknown;
}

/** Everything the model needs to produce the next assistant turn. */
export interface ModelRequest {
  system?: string;
  messages: Message[];
  tools?: ToolSpec[];
  signal?: AbortSignal;
}

/**
 * Discriminant tags for {@link StreamEvent}. A string enum whose values are the
 * wire strings they replace, so nothing about the emitted events changes on the
 * wire — only in-code references become named constants.
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

/** Incremental output from the model. See {@link StreamEventType} for each tag. */
export type StreamEvent =
  | { type: StreamEventType.ReasoningDelta; text: string }
  | { type: StreamEventType.TextDelta; text: string }
  | { type: StreamEventType.ToolCall; toolCall: ToolCall }
  | { type: StreamEventType.Done; message: Message }
  | { type: StreamEventType.Error; error: Error; message: Message };

/** A live model response: async-iterable of events. */
export type ModelStream = AsyncIterable<StreamEvent>;

export interface ModelClient {
  /** Begin a streaming completion. Implementations MUST stream by default. */
  stream(request: ModelRequest): ModelStream;
}
