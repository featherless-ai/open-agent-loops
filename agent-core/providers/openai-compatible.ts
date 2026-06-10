/**
 * OpenAICompatibleModel — a ModelClient backed by the official `openai` SDK
 * (zero runtime deps, native fetch), pointed at any OpenAI-compatible endpoint
 * via `baseURL`: Featherless, vLLM, Together, Groq, Fireworks, DeepSeek, ...
 *
 * `openai` is an OPTIONAL peer dependency — install it only if you use this
 * provider. The core loop never imports it; you reach this file by its own
 * path (`~/agent-core/providers/openai-compatible`), so consumers who bring
 * their own ModelClient never pull the SDK in.
 *
 * Reasoning: OpenAI-compatible reasoning models stream chain-of-thought on a
 * non-standard delta field — `reasoning` (current vLLM / OpenAI-style) or
 * `reasoning_content` (DeepSeek). Those aren't in the SDK's types, so we read
 * them off the delta directly and emit `reasoning_delta`. When we send an
 * assistant turn back we attach `reasoning_content` if present, which DeepSeek
 * thinking mode requires on tool-call turns.
 *
 * Reasoning field-name asymmetry (verified against Featherless / GLM-5.1):
 * models emit reasoning on the `reasoning` field but only ACCEPT it back on the
 * `reasoning_content` field — and only when the chat template is told not to
 * strip prior thinking. For those models pass
 * `chatTemplateKwargs: { enable_thinking: true, clear_thinking: false }`; with
 * the default (or `clear_thinking: true`) the server drops inbound reasoning
 * before the model sees it, so prior-turn thinking silently fails to round-trip.
 *
 * Debugging: pass `onRawSSE` to tap every raw line the server streams, before
 * the SDK parses it. See `sseTapFetch` below — it tees the response body, so
 * the tap never steals bytes from the SDK.
 *
 * @module
 */

import OpenAI from "openai";
import type { ModelClient, ModelRequest, ModelStream, StreamEvent, ToolSpec } from "../model.types";
import { StreamEventType } from "../model.types";
import type { Message, ReasoningDetail, ToolCall } from "../types";
import { FinishReason, ReasoningFormat, Role, ToolCallType } from "../types";

type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;
type ChatChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

/**
 * Minimal fetch shape the SDK accepts — narrower than the DOM `typeof fetch`.
 *
 * @internal
 */
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Construction options for {@link OpenAICompatibleModel}.
 *
 * @group Model
 */
export interface OpenAICompatibleOptions {
  /** Model id to call, e.g. "deepseek-ai/DeepSeek-V3.1". */
  model: string;
  /** Base URL of the OpenAI-compatible endpoint (e.g. https://api.featherless.ai/v1). */
  baseURL?: string;
  /** API key for the endpoint. Falls back to the SDK's env handling if omitted. */
  apiKey?: string;
  /**
   * Inject a preconfigured OpenAI client (tests, Azure, custom transport).
   * When set, baseURL / apiKey / onRawSSE are ignored — configure the client
   * you pass in instead.
   */
  client?: OpenAI;
  /**
   * Developer tap on the raw SSE stream: invoked once per non-empty line the
   * server sends (e.g. `data: {...}`), before the SDK parses it. Debugging
   * only — it cannot change what the loop receives.
   */
  onRawSSE?: (line: string) => void;
  /**
   * Per-request timeout in milliseconds. A request that exceeds this aborts and
   * surfaces as an {@link StreamEventType.Error} event (the SDK throws
   * `APIConnectionTimeoutError`, which the stream catches). Defaults to 5
   * minutes when omitted. Ignored when {@link client} is set.
   */
  timeout?: number;
  /**
   * Max automatic retries on connection errors / timeouts / 408 / 409 / 429 /
   * 5xx, with exponential backoff (SDK behavior). Defaults to the SDK default
   * (2) when omitted. Ignored when {@link client} is set.
   */
  maxRetries?: number;
  /** Extra create params merged into every request (temperature, top_p, ...). */
  params?: Partial<Omit<ChatParams, "model" | "messages" | "tools" | "stream">>;
  /**
   * Non-standard `chat_template_kwargs` forwarded in the request body — vLLM /
   * Featherless render these into the chat template. Use to control thinking
   * mode on templated reasoning models, e.g.
   * `{ enable_thinking: true, clear_thinking: false }` so prior-turn reasoning
   * (resent as `reasoning_content`) actually round-trips. Leave unset for
   * endpoints that reject unknown body fields (OpenAI proper, Groq).
   */
  chatTemplateKwargs?: Record<string, unknown>;
}

/**
 * A {@link ModelClient} backed by the official `openai` SDK, pointed at any
 * OpenAI-compatible endpoint.
 *
 * @remarks
 * Works against Featherless, vLLM, Together, Groq, Fireworks, DeepSeek, and
 * similar endpoints via {@link OpenAICompatibleOptions.baseURL | baseURL}. The
 * `openai` package is an OPTIONAL peer dependency — the core loop never imports
 * this file, so consumers who bring their own {@link ModelClient} never pull the
 * SDK in.
 *
 * @example
 * ```ts
 * const model = new OpenAICompatibleModel({
 *   model: "deepseek-ai/DeepSeek-V3.1",
 *   baseURL: "https://api.featherless.ai/v1",
 *   apiKey: process.env.FEATHERLESS_API_KEY,
 * });
 * for await (const event of model.stream({ messages: [{ role: Role.User, content: "hi" }] })) {
 *   if (event.type === StreamEventType.TextDelta) process.stdout.write(event.text);
 * }
 * ```
 * @see {@link OpenAICompatibleOptions}
 * @group Model
 */
export class OpenAICompatibleModel implements ModelClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly extra: OpenAICompatibleOptions["params"];
  private readonly chatTemplateKwargs: OpenAICompatibleOptions["chatTemplateKwargs"];

  /**
   * Create a model client for an OpenAI-compatible endpoint.
   *
   * @param options - Model id, endpoint, credentials, and request extras.
   */
  constructor(options: OpenAICompatibleOptions) {
    this.model = options.model;
    this.extra = options.params;
    this.chatTemplateKwargs = options.chatTemplateKwargs;
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
        timeout: options.timeout ?? 5 * 60 * 1000,
        ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
        fetch: options.onRawSSE ? sseTapFetch(options.onRawSSE) : undefined,
      });
  }

  /**
   * Begin a streaming completion against the configured endpoint.
   *
   * @param request - The system prompt, history, and tools for this turn.
   * @returns An async iterable of {@link StreamEvent}s for the assistant turn.
   */
  stream(request: ModelRequest): ModelStream {
    return this.run(request);
  }

  /**
   * Build the chat params, open the SDK stream, and translate it to events.
   *
   * @internal
   */
  private async *run(request: ModelRequest): AsyncGenerator<StreamEvent> {
    // `chat_template_kwargs` isn't in the SDK's param types — it's a vLLM /
    // Featherless body extension — so widen the local type to carry it through.
    const params: ChatParams & { chat_template_kwargs?: Record<string, unknown> } = {
      ...this.extra,
      model: this.model,
      messages: toChatMessages(request),
      stream: true,
      ...(request.tools && request.tools.length > 0
        ? { tools: request.tools.map(toChatTool) }
        : {}),
      ...(this.chatTemplateKwargs ? { chat_template_kwargs: this.chatTemplateKwargs } : {}),
    };

    let chunks: AsyncIterable<ChatChunk>;
    try {
      chunks = await this.client.chat.completions.create(params, { signal: request.signal });
    } catch (error) {
      // Connection / request-setup failure: nothing streamed yet.
      yield { type: StreamEventType.Error, error: asError(error), message: emptyAssistant() };
      return;
    }
    yield* chunksToEvents(chunks);
  }
}

// --- pure mapping (exported for testing) -------------------------------------

/**
 * Map a {@link ModelRequest} to OpenAI chat messages (system prepended if present).
 *
 * @param request - The request whose system prompt and messages to convert.
 * @returns The chat messages in OpenAI wire shape.
 * @group Model
 */
export function toChatMessages(request: ModelRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (request.system) messages.push({ role: "system", content: request.system });
  for (const message of request.messages) messages.push(toChatMessage(message));
  return messages;
}

/**
 * Convert one {@link Message} to its OpenAI chat-message wire shape.
 *
 * @internal
 */
function toChatMessage(message: Message): ChatMessage {
  switch (message.role) {
    case Role.System:
      return { role: "system", content: message.content };
    case Role.User:
      return { role: "user", content: message.content };
    case Role.Tool:
      return { role: "tool", tool_call_id: message.tool_call_id ?? "", content: message.content };
    case Role.Assistant: {
      const out: Record<string, unknown> = { role: "assistant", content: message.content };
      // tool_calls is already the OpenAI wire shape, so it passes straight through.
      if (message.tool_calls && message.tool_calls.length > 0) out.tool_calls = message.tool_calls;
      // Resend reasoning on tool-call turns (DeepSeek thinking mode needs it);
      // prepareRequestMessages already dropped it from plain turns. Prefer the
      // verbatim structured blocks when present (signed/encrypted models require
      // the exact sequence back); otherwise fall back to the flat string that
      // raw-string reasoning models (DeepSeek, GLM) accept on `reasoning_content`.
      if (message.reasoning_details && message.reasoning_details.length > 0) {
        out.reasoning_details = message.reasoning_details;
      } else if (message.reasoning) {
        out.reasoning_content = message.reasoning;
      }
      return out as unknown as ChatMessage;
    }
    default: {
      const unreachable: never = message.role;
      throw new Error(`Unknown message role: ${String(unreachable)}`);
    }
  }
}

/**
 * Map a {@link ToolSpec} to an OpenAI function tool.
 *
 * @param spec - The tool description to convert.
 * @returns The tool in OpenAI function-tool wire shape.
 * @group Model
 */
export function toChatTool(spec: ToolSpec): ChatTool {
  return {
    type: "function",
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters as Record<string, unknown>,
    },
  };
}

/**
 * Accumulator for one tool call whose fields stream across chunks.
 *
 * @internal
 */
interface ToolDraft {
  id: string;
  name: string;
  args: string;
}

/**
 * Accumulator for one structured reasoning block whose text/data streams across
 * chunks. Metadata (type/id/format/signature) is taken from whichever chunk
 * carries it; the body strings are concatenated in arrival order.
 *
 * @internal
 */
interface ReasoningDraft {
  type: ReasoningDetail["type"] | "";
  id: string | null;
  format: ReasoningFormat;
  index?: number;
  body: string;
  signature: string | null;
}

/**
 * Translate the SDK's chunk stream into {@link StreamEvent}s.
 *
 * @remarks
 * Text and reasoning are emitted as deltas the moment they arrive; tool calls
 * (whose arguments stream as string fragments) are accumulated and emitted whole
 * at the end, followed by the assembled `done` message. A mid-stream throw
 * becomes an `error` event carrying whatever was assembled so far.
 *
 * @param chunks - The SDK's streamed chat-completion chunks.
 * @returns An async iterable of {@link StreamEvent}s.
 * @group Model
 */
export async function* chunksToEvents(chunks: AsyncIterable<ChatChunk>): AsyncGenerator<StreamEvent> {
  const acc: StreamAccumulator = {
    content: "",
    reasoning: "",
    toolDrafts: new Map(),
    reasoningDrafts: new Map(),
    finishReason: undefined,
  };

  try {
    for await (const chunk of chunks) {
      const choice = chunk.choices[0];
      const finish = mapFinishReason(choice?.finish_reason);
      if (finish) acc.finishReason = finish;

      const delta = choice?.delta;
      if (!delta) continue;

      // Flat string reasoning (DeepSeek / GLM / vLLM) streams ready to display.
      const reasoningText = readReasoning(delta);
      if (reasoningText) {
        acc.reasoning += reasoningText;
        yield { type: StreamEventType.ReasoningDelta, text: reasoningText };
      }
      // Structured reasoning blocks: accumulate verbatim by index; surface the
      // human-readable text/summary as deltas so display still works.
      for (const display of accumulateReasoningDetails(delta, acc.reasoningDrafts)) {
        acc.reasoning += display;
        yield { type: StreamEventType.ReasoningDelta, text: display };
      }
      if (delta.content) {
        acc.content += delta.content;
        yield { type: StreamEventType.TextDelta, text: delta.content };
      }
      for (const call of delta.tool_calls ?? []) {
        const draft = acc.toolDrafts.get(call.index) ?? { id: "", name: "", args: "" };
        if (call.id) draft.id = call.id;
        if (call.function?.name) draft.name = call.function.name;
        if (call.function?.arguments) draft.args += call.function.arguments;
        acc.toolDrafts.set(call.index, draft);
      }
    }
  } catch (error) {
    yield { type: StreamEventType.Error, error: asError(error), message: assemble(acc) };
    return;
  }

  const message = assemble(acc);
  for (const toolCall of message.tool_calls ?? []) yield { type: StreamEventType.ToolCall, toolCall };
  yield { type: StreamEventType.Done, message, ...(acc.finishReason ? { finishReason: acc.finishReason } : {}) };
}

/**
 * Everything one streamed turn accumulates before it is assembled into a Message.
 *
 * @internal
 */
interface StreamAccumulator {
  content: string;
  /** Flattened, human-readable reasoning (flat field + text/summary blocks). */
  reasoning: string;
  toolDrafts: Map<number, ToolDraft>;
  /** Verbatim structured reasoning blocks, keyed by their stream index. */
  reasoningDrafts: Map<number, ReasoningDraft>;
  finishReason?: FinishReason;
}

/**
 * Read the non-standard flat reasoning field off a delta (`reasoning` |
 * `reasoning_content`).
 *
 * @internal
 */
function readReasoning(delta: object): string {
  const record = delta as Record<string, unknown>;
  const value = record.reasoning ?? record.reasoning_content;
  return typeof value === "string" ? value : "";
}

/**
 * Fold a delta's `reasoning_details[]` chunks into the per-index drafts,
 * preserving every block verbatim. Returns the human-readable fragments
 * (`reasoning.text` / `reasoning.summary`) seen in THIS delta, in order, so the
 * caller can stream them as display deltas. Encrypted blocks contribute no
 * display text (their `data` is opaque and may arrive as `[REDACTED]`).
 *
 * @internal
 */
function accumulateReasoningDetails(
  delta: object,
  drafts: Map<number, ReasoningDraft>,
): string[] {
  const raw = (delta as Record<string, unknown>).reasoning_details;
  if (!Array.isArray(raw)) return [];

  const display: string[] = [];
  raw.forEach((entry, position) => {
    if (entry === null || typeof entry !== "object") return;
    const block = entry as Record<string, unknown>;
    // Most providers send a per-block `index`; fall back to array position for
    // the single-block streams that omit it.
    const key = typeof block.index === "number" ? block.index : position;
    const draft = drafts.get(key) ?? {
      type: "",
      id: null,
      format: ReasoningFormat.AnthropicClaudeV1,
      index: typeof block.index === "number" ? block.index : undefined,
      body: "",
      signature: null,
    };
    if (typeof block.type === "string") draft.type = block.type as ReasoningDraft["type"];
    if (typeof block.id === "string") draft.id = block.id;
    if (typeof block.format === "string") draft.format = block.format as ReasoningFormat;
    if (typeof block.signature === "string") draft.signature = block.signature;

    const fragment = readBlockBody(block);
    draft.body += fragment;
    if (fragment && block.type !== "reasoning.encrypted") display.push(fragment);

    drafts.set(key, draft);
  });
  return display;
}

/**
 * Extract the streamed body string of a reasoning block, whichever field its
 * type uses (`text` / `summary` / `data`).
 *
 * @internal
 */
function readBlockBody(block: Record<string, unknown>): string {
  const value = block.text ?? block.summary ?? block.data;
  return typeof value === "string" ? value : "";
}

/**
 * Finalize the per-index reasoning drafts into verbatim {@link ReasoningDetail}
 * blocks, ordered by stream index.
 *
 * @internal
 */
function assembleReasoningDetails(drafts: Map<number, ReasoningDraft>): ReasoningDetail[] {
  return [...drafts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, draft]): ReasoningDetail => {
      const base = { id: draft.id, format: draft.format, ...(draft.index !== undefined ? { index: draft.index } : {}) };
      switch (draft.type) {
        case "reasoning.summary":
          return { ...base, type: "reasoning.summary", summary: draft.body };
        case "reasoning.encrypted":
          return { ...base, type: "reasoning.encrypted", data: draft.body };
        case "reasoning.text":
        default:
          // Default unknown/blank types to text — the only shape with an
          // optional signature, so nothing signed is dropped.
          return {
            ...base,
            type: "reasoning.text",
            text: draft.body,
            ...(draft.signature !== null ? { signature: draft.signature } : {}),
          };
      }
    });
}

/**
 * Map a wire `finish_reason` to the {@link FinishReason} enum, or `undefined`
 * when the provider sent none (still streaming) or an unrecognized value.
 *
 * @internal
 */
function mapFinishReason(reason: string | null | undefined): FinishReason | undefined {
  switch (reason) {
    case "stop":
      return FinishReason.Stop;
    case "tool_calls":
      return FinishReason.ToolCalls;
    case "length":
      return FinishReason.Length;
    case "content_filter":
      return FinishReason.ContentFilter;
    default:
      return undefined;
  }
}

/**
 * Assemble accumulated content, reasoning, tool drafts, reasoning-detail drafts,
 * and finish reason into a Message.
 *
 * @internal
 */
function assemble(acc: StreamAccumulator): Message {
  // Keep `arguments` as the raw accumulated JSON string (wire format) — the
  // loop JSON-parses and schema-validates it before the tool runs.
  const toolCalls: ToolCall[] = [...acc.toolDrafts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, draft]) => ({ id: draft.id, type: ToolCallType.Function, function: { name: draft.name, arguments: draft.args } }));
  const reasoningDetails = assembleReasoningDetails(acc.reasoningDrafts);
  return {
    role: Role.Assistant,
    content: acc.content,
    ...(acc.reasoning ? { reasoning: acc.reasoning } : {}),
    ...(reasoningDetails.length > 0 ? { reasoning_details: reasoningDetails } : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(acc.finishReason ? { finishReason: acc.finishReason } : {}),
    timestamp: Date.now(),
  };
}

/**
 * An empty assistant message, used when a request fails before streaming.
 *
 * @internal
 */
function emptyAssistant(): Message {
  return { role: Role.Assistant, content: "", timestamp: Date.now() };
}

/**
 * Coerce an unknown thrown value into an Error.
 *
 * @internal
 */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// --- raw SSE debug tap -------------------------------------------------------

/**
 * Wrap `fetch` so each non-empty line of the streamed response is handed to
 * `onLine` for inspection — without consuming the body the SDK needs.
 *
 * @remarks
 * The response stream is tee'd: one branch feeds the SDK, the other feeds the
 * tap. Logging is best-effort and never surfaces an error to the caller.
 *
 * @param onLine - Called once per non-empty streamed line.
 * @returns A `fetch`-compatible function for the OpenAI client.
 * @see {@link OpenAICompatibleOptions.onRawSSE}
 * @group Model
 */
export function sseTapFetch(onLine: (line: string) => void): FetchLike {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const response = await fetch(input, init);
    if (!response.body) return response;
    const [forSdk, forTap] = response.body.tee();
    void drainLines(forTap, onLine);
    return new Response(forSdk, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}

/**
 * Decode a byte stream into newline-delimited lines, calling `onLine` per
 * non-empty line.
 *
 * @param stream - The byte stream to decode (e.g. a tee'd response body).
 * @param onLine - Called once per non-empty decoded line.
 * @returns A promise that resolves when the stream is fully drained.
 * @group Model
 */
export async function drainLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) onLine(line);
      }
    }
    const tail = buffer.trim();
    if (tail) onLine(tail);
  } catch {
    // best-effort debugging tap
  } finally {
    reader.releaseLock();
  }
}
