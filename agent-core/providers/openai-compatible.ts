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
 * Debugging: pass `onRawSSE` to tap every raw line the server streams, before
 * the SDK parses it. See `sseTapFetch` below — it tees the response body, so
 * the tap never steals bytes from the SDK.
 */

import OpenAI from "openai";
import type { ModelClient, ModelRequest, ModelStream, StreamEvent, ToolSpec } from "../model.types";
import { StreamEventType } from "../model.types";
import type { Message, ToolCall } from "../types";
import { Role, ToolCallType } from "../types";

type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;
type ChatChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

/** Minimal fetch shape the SDK accepts — narrower than the DOM `typeof fetch`. */
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

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
  /** Extra create params merged into every request (temperature, top_p, ...). */
  params?: Partial<Omit<ChatParams, "model" | "messages" | "tools" | "stream">>;
}

export class OpenAICompatibleModel implements ModelClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly extra: OpenAICompatibleOptions["params"];

  constructor(options: OpenAICompatibleOptions) {
    this.model = options.model;
    this.extra = options.params;
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
        fetch: options.onRawSSE ? sseTapFetch(options.onRawSSE) : undefined,
      });
  }

  stream(request: ModelRequest): ModelStream {
    return this.run(request);
  }

  private async *run(request: ModelRequest): AsyncGenerator<StreamEvent> {
    const params: ChatParams = {
      ...this.extra,
      model: this.model,
      messages: toChatMessages(request),
      stream: true,
      ...(request.tools && request.tools.length > 0
        ? { tools: request.tools.map(toChatTool) }
        : {}),
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

/** Map a ModelRequest to OpenAI chat messages (system prepended if present). */
export function toChatMessages(request: ModelRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (request.system) messages.push({ role: "system", content: request.system });
  for (const message of request.messages) messages.push(toChatMessage(message));
  return messages;
}

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
      // prepareRequestMessages already dropped it from plain turns.
      if (message.reasoning) out.reasoning_content = message.reasoning;
      return out as unknown as ChatMessage;
    }
    default: {
      const unreachable: never = message.role;
      throw new Error(`Unknown message role: ${String(unreachable)}`);
    }
  }
}

/** Map a ToolSpec to an OpenAI function tool. */
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

interface ToolDraft {
  id: string;
  name: string;
  args: string;
}

/**
 * Translate the SDK's chunk stream into StreamEvents. Text and reasoning are
 * emitted as deltas the moment they arrive; tool calls (whose arguments stream
 * as string fragments) are accumulated and emitted whole at the end, followed
 * by the assembled `done` message. A mid-stream throw becomes an `error` event
 * carrying whatever was assembled so far.
 */
export async function* chunksToEvents(chunks: AsyncIterable<ChatChunk>): AsyncGenerator<StreamEvent> {
  let content = "";
  let reasoning = "";
  const toolDrafts = new Map<number, ToolDraft>();

  try {
    for await (const chunk of chunks) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      const reasoningText = readReasoning(delta);
      if (reasoningText) {
        reasoning += reasoningText;
        yield { type: StreamEventType.ReasoningDelta, text: reasoningText };
      }
      if (delta.content) {
        content += delta.content;
        yield { type: StreamEventType.TextDelta, text: delta.content };
      }
      for (const call of delta.tool_calls ?? []) {
        const draft = toolDrafts.get(call.index) ?? { id: "", name: "", args: "" };
        if (call.id) draft.id = call.id;
        if (call.function?.name) draft.name = call.function.name;
        if (call.function?.arguments) draft.args += call.function.arguments;
        toolDrafts.set(call.index, draft);
      }
    }
  } catch (error) {
    yield { type: StreamEventType.Error, error: asError(error), message: assemble(content, reasoning, toolDrafts) };
    return;
  }

  const message = assemble(content, reasoning, toolDrafts);
  for (const toolCall of message.tool_calls ?? []) yield { type: StreamEventType.ToolCall, toolCall };
  yield { type: StreamEventType.Done, message };
}

/** Read the non-standard reasoning field off a delta (`reasoning` | `reasoning_content`). */
function readReasoning(delta: object): string {
  const record = delta as Record<string, unknown>;
  const value = record.reasoning ?? record.reasoning_content;
  return typeof value === "string" ? value : "";
}

function assemble(content: string, reasoning: string, drafts: Map<number, ToolDraft>): Message {
  // Keep `arguments` as the raw accumulated JSON string (wire format) — the
  // loop JSON-parses and schema-validates it before the tool runs.
  const toolCalls: ToolCall[] = [...drafts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, draft]) => ({ id: draft.id, type: ToolCallType.Function, function: { name: draft.name, arguments: draft.args } }));
  return {
    role: Role.Assistant,
    content,
    ...(reasoning ? { reasoning } : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    timestamp: Date.now(),
  };
}

function emptyAssistant(): Message {
  return { role: Role.Assistant, content: "", timestamp: Date.now() };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// --- raw SSE debug tap -------------------------------------------------------

/**
 * Wrap `fetch` so each non-empty line of the streamed response is handed to
 * `onLine` for inspection — without consuming the body the SDK needs. The
 * response stream is tee'd: one branch feeds the SDK, the other feeds the tap.
 * Logging is best-effort and never surfaces an error to the caller.
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

/** Decode a byte stream into newline-delimited lines, calling `onLine` per non-empty line. */
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
