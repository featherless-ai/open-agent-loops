/**
 * A deterministic, streaming ModelClient for tests. It replays scripted turns
 * instead of calling a real LLM, so the loop, memory, tool dispatch, stop
 * conditions, and hooks can all be verified with zero network.
 *
 * Streaming is on by default (all models stream): assistant text is emitted as
 * multiple `text_delta` chunks. Set `chunkSize: Infinity` to emit text in one
 * shot for the rare test that wants a non-streamed turn.
 */

import type { Message, ToolCall } from "../types";
import type { ModelClient, ModelRequest, ModelStream, StreamEvent } from "../model.types";

/** One scripted assistant turn: some text and/or some tool calls. */
export interface ScriptedTurn {
  text?: string;
  /** Chain-of-thought, streamed as `reasoning_delta` chunks before the text. */
  reasoning?: string;
  /**
   * Tool calls to emit. Authoring shape (name + an object of args); the fake
   * serializes `arguments` to the wire JSON string for you, so tests stay
   * readable while the emitted ToolCall matches the real wire format.
   */
  toolCalls?: Array<{ id?: string; name: string; arguments?: Record<string, unknown> }>;
  /** Force this turn to stream as an error after emitting its content. */
  error?: string;
}

/** Either a fixed list of turns or a function that decides per call. */
export type Script =
  | ScriptedTurn[]
  | ((request: ModelRequest, callIndex: number) => ScriptedTurn);

export interface FakeModelOptions {
  /** Characters per `text_delta` chunk. Default 8. Use Infinity for one chunk. */
  chunkSize?: number;
}

export class FakeModelClient implements ModelClient {
  /** Every request the loop made, in order — handy for assertions. */
  readonly requests: ModelRequest[] = [];
  private callIndex = 0;
  private readonly chunkSize: number;

  constructor(private readonly script: Script, options: FakeModelOptions = {}) {
    this.chunkSize = options.chunkSize ?? 8;
  }

  stream(request: ModelRequest): ModelStream {
    this.requests.push(request);
    const turn = this.nextTurn(request, this.callIndex++);
    return this.run(turn);
  }

  /** Resolve the scripted turn for this call, whether array- or fn-based. */
  private nextTurn(request: ModelRequest, index: number): ScriptedTurn {
    if (typeof this.script === "function") {
      return this.script(request, index);
    }
    const turn = this.script[index];
    if (!turn) {
      throw new Error(
        `FakeModelClient: no scripted turn for call #${index} ` +
          `(script has ${this.script.length} turn(s))`,
      );
    }
    return turn;
  }

  /** Produce the event stream for a single turn. */
  private async *run(turn: ScriptedTurn): AsyncGenerator<StreamEvent> {
    const reasoning = turn.reasoning ?? "";
    const text = turn.text ?? "";

    // 1. Stream chain-of-thought (if any) before the answer, as chunks — the
    //    same separate channel reasoning models emit ahead of the content.
    for (const chunk of chunkText(reasoning, this.chunkSize)) {
      yield { type: "reasoning_delta", text: chunk };
    }

    // 2. Stream the text content as chunks (the "all models stream" default).
    for (const chunk of chunkText(text, this.chunkSize)) {
      yield { type: "text_delta", text: chunk };
    }

    // 3. Emit any tool calls, assigning ids when the script omitted them and
    //    serializing object args to the wire JSON string.
    const toolCalls: ToolCall[] = (turn.toolCalls ?? []).map((call, i) => ({
      id: call.id ?? `call_${this.callIndex}_${i}`,
      type: "function",
      function: {
        name: call.name,
        arguments: JSON.stringify(call.arguments ?? {}),
      },
    }));
    for (const toolCall of toolCalls) {
      yield { type: "tool_call", toolCall };
    }

    // 4. Assemble the final assistant message and emit the terminal event.
    const message: Message = {
      role: "assistant",
      content: text,
      ...(reasoning ? { reasoning } : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      timestamp: Date.now(),
    };

    if (turn.error) {
      yield { type: "error", error: new Error(turn.error), message };
      return;
    }
    yield { type: "done", message };
  }
}

/** Split text into chunks of at most `size` characters (preserving order). */
function chunkText(text: string, size: number): string[] {
  if (text.length === 0) return [];
  if (!Number.isFinite(size) || size >= text.length) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
