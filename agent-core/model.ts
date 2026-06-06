/**
 * The single LLM boundary. The loop never talks to a provider directly — it
 * only depends on `ModelClient`, so any backend (fake, OpenAI-compatible,
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
 * Incremental output from the model.
 * - `text_delta`  partial assistant text (streamed token-by-token / chunked)
 * - `tool_call`   a fully-formed tool invocation the model wants to make
 * - `done`        terminal event carrying the assembled assistant message
 * - `error`       the model failed; `message` holds whatever was assembled
 */
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "done"; message: Message }
  | { type: "error"; error: Error; message: Message };

/** A live model response: async-iterable of events. */
export type ModelStream = AsyncIterable<StreamEvent>;

export interface ModelClient {
  /** Begin a streaming completion. Implementations MUST stream by default. */
  stream(request: ModelRequest): ModelStream;
}
