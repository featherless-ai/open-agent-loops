/**
 * A deterministic, streaming `ModelClient` for tests.
 *
 * @remarks
 * This is a testing utility. It replays scripted turns instead of calling a
 * real LLM, so the loop, memory, tool dispatch, stop conditions, and hooks can
 * all be verified with zero network.
 *
 * Streaming is on by default (all models stream): assistant text is emitted as
 * multiple `text_delta` chunks. Set `chunkSize: Infinity` to emit text in one
 * shot for the rare test that wants a non-streamed turn.
 *
 * @module
 */

import type { Message, ToolCall } from "../types";
import { Role, ToolCallType } from "../types";
import type { ModelClient, ModelRequest, ModelStream, StreamEvent } from "../model.types";
import { StreamEventType } from "../model.types";

/**
 * One scripted assistant turn: some text and/or some tool calls.
 *
 * @see {@link MockModelClient}
 * @group Testing
 */
export interface ScriptedTurn {
  /** The assistant text content for this turn, streamed as `text_delta` chunks. */
  text?: string;
  /** Chain-of-thought, streamed as `reasoning_delta` chunks before the text. */
  reasoning?: string;
  /**
   * Tool calls to emit. Authoring shape (name + an object of args); the mock
   * serializes `arguments` to the wire JSON string for you, so tests stay
   * readable while the emitted ToolCall matches the real wire format.
   */
  toolCalls?: Array<{ id?: string; name: string; arguments?: Record<string, unknown> }>;
  /** Force this turn to stream as an error after emitting its content. */
  error?: string;
}

/**
 * The script driving a {@link MockModelClient}: either a fixed list of turns or
 * a function that decides per call.
 *
 * @group Testing
 */
export type Script =
  | ScriptedTurn[]
  | ((request: ModelRequest, callIndex: number) => ScriptedTurn);

/**
 * Construction options for {@link MockModelClient}.
 *
 * @group Testing
 */
export interface MockModelOptions {
  /** Characters per `text_delta` chunk. Default 8. Use Infinity for one chunk. */
  chunkSize?: number;
}

/**
 * Deterministic, streaming {@link ModelClient} that replays a {@link Script}.
 *
 * @remarks
 * This is a testing utility. Each call to {@link MockModelClient.stream} pulls
 * the next {@link ScriptedTurn} and emits it as a realistic event stream
 * (reasoning deltas, text deltas, tool calls, then a terminal `Done` or
 * `Error`). Every {@link ModelRequest} is recorded in {@link requests} for
 * assertions.
 *
 * @example
 * ```ts
 * const model = new MockModelClient([
 *   { reasoning: "thinking...", text: "Let me search." ,
 *     toolCalls: [{ name: "search", arguments: { q: "cats" } }] },
 *   { text: "Here is your answer." },
 * ]);
 * for await (const event of model.stream(request)) {
 *   // handle text_delta / tool_call / done events
 * }
 * expect(model.requests).toHaveLength(1);
 * ```
 *
 * @see {@link Script}
 * @see {@link ScriptedTurn}
 * @group Testing
 */
export class MockModelClient implements ModelClient {
  /** Every request the loop made, in order — handy for assertions. */
  readonly requests: ModelRequest[] = [];
  private callIndex = 0;
  private readonly chunkSize: number;

  /**
   * @param script - The fixed turns or per-call function to replay.
   * @param options - Streaming options; see {@link MockModelOptions}.
   */
  constructor(private readonly script: Script, options: MockModelOptions = {}) {
    this.chunkSize = options.chunkSize ?? 8;
  }

  /**
   * Record the request and return the event stream for the next scripted turn.
   * @param request - The model request issued by the loop.
   * @returns A stream of {@link StreamEvent}s for this turn.
   * @throws Error if an array-based script has no turn for this call index.
   */
  stream(request: ModelRequest): ModelStream {
    this.requests.push(request);
    const turn = this.nextTurn(request, this.callIndex++);
    return this.run(turn);
  }

  /**
   * Resolve the scripted turn for this call, whether array- or fn-based.
   * @param request - The current model request (passed to fn-based scripts).
   * @param index - Zero-based call index.
   * @returns The {@link ScriptedTurn} to replay.
   * @throws Error if an array-based script has no turn at `index`.
   * @internal
   */
  private nextTurn(request: ModelRequest, index: number): ScriptedTurn {
    if (typeof this.script === "function") {
      return this.script(request, index);
    }
    const turn = this.script[index];
    if (!turn) {
      throw new Error(
        `MockModelClient: no scripted turn for call #${index} ` +
          `(script has ${this.script.length} turn(s))`,
      );
    }
    return turn;
  }

  /**
   * Produce the event stream for a single turn.
   * @param turn - The scripted turn to emit.
   * @returns An async generator of {@link StreamEvent}s for the turn.
   * @internal
   */
  private async *run(turn: ScriptedTurn): AsyncGenerator<StreamEvent> {
    const reasoning = turn.reasoning ?? "";
    const text = turn.text ?? "";

    // 1. Stream chain-of-thought (if any) before the answer, as chunks — the
    //    same separate channel reasoning models emit ahead of the content.
    for (const chunk of chunkText(reasoning, this.chunkSize)) {
      yield { type: StreamEventType.ReasoningDelta, text: chunk };
    }

    // 2. Stream the text content as chunks (the "all models stream" default).
    for (const chunk of chunkText(text, this.chunkSize)) {
      yield { type: StreamEventType.TextDelta, text: chunk };
    }

    // 3. Emit any tool calls, assigning ids when the script omitted them and
    //    serializing object args to the wire JSON string.
    const toolCalls: ToolCall[] = (turn.toolCalls ?? []).map((call, i) => ({
      id: call.id ?? `call_${this.callIndex}_${i}`,
      type: ToolCallType.Function,
      function: {
        name: call.name,
        arguments: JSON.stringify(call.arguments ?? {}),
      },
    }));
    for (const toolCall of toolCalls) {
      yield { type: StreamEventType.ToolCall, toolCall };
    }

    // 4. Assemble the final assistant message and emit the terminal event.
    const message: Message = {
      role: Role.Assistant,
      content: text,
      ...(reasoning ? { reasoning } : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      timestamp: Date.now(),
    };

    if (turn.error) {
      yield { type: StreamEventType.Error, error: new Error(turn.error), message };
      return;
    }
    yield { type: StreamEventType.Done, message };
  }
}

/**
 * Split text into chunks of at most `size` characters (preserving order).
 * @param text - The text to split.
 * @param size - Maximum characters per chunk; `Infinity` yields one chunk.
 * @returns The chunks in order, or an empty array for empty input.
 * @internal
 */
function chunkText(text: string, size: number): string[] {
  if (text.length === 0) return [];
  if (!Number.isFinite(size) || size >= text.length) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
