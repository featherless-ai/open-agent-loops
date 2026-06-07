import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import {
  OpenAICompatibleModel,
  chunksToEvents,
  drainLines,
} from "../providers/openai-compatible";
import type { StreamEvent } from "../model.types";
import { StreamEventType } from "../model.types";
import { Role, ToolCallType } from "../types";

type ChatChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

/** Build a minimal streaming chunk carrying a single choice delta. */
function chunk(delta: Record<string, unknown>): ChatChunk {
  return {
    id: "c",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta, finish_reason: null }],
  } as unknown as ChatChunk;
}

async function* stream(...chunks: ChatChunk[]): AsyncGenerator<ChatChunk> {
  for (const c of chunks) yield c;
}

async function collect(events: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe("chunksToEvents", () => {
  // Base case: text streams as deltas and ends with an assembled done message.
  test("base: content deltas then a done message", async () => {
    const events = await collect(chunksToEvents(stream(chunk({ content: "he" }), chunk({ content: "llo" }))));
    expect(events.map((e) => e.type)).toEqual([StreamEventType.TextDelta, StreamEventType.TextDelta, StreamEventType.Done]);
    expect((events.at(-1) as any).message.content).toBe("hello");
  });

  // Edge: reasoning deltas surface separately and land on the message.
  test("edge: reasoning is its own channel", async () => {
    const events = await collect(chunksToEvents(stream(chunk({ reasoning: "think" }), chunk({ content: "ok" }))));
    expect(events.map((e) => e.type)).toEqual([StreamEventType.ReasoningDelta, StreamEventType.TextDelta, StreamEventType.Done]);
    const done = events.at(-1) as any;
    expect(done.message.reasoning).toBe("think");
    expect(done.message.content).toBe("ok");
  });

  // Edge: the legacy reasoning_content field is read too.
  test("edge: reads legacy reasoning_content", async () => {
    const events = await collect(chunksToEvents(stream(chunk({ reasoning_content: "legacy" }))));
    expect((events[0] as any).text).toBe("legacy");
    expect((events.at(-1) as any).message.reasoning).toBe("legacy");
  });

  // Edge: tool-call argument fragments accumulate into one parsed tool_call.
  test("edge: streamed tool-call fragments assemble into one call", async () => {
    const events = await collect(
      chunksToEvents(
        stream(
          chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "search", arguments: '{"q":' } }] }),
          chunk({ tool_calls: [{ index: 0, function: { arguments: '"paris"}' } }] }),
        ),
      ),
    );
    const toolCall = events.find((e) => e.type === StreamEventType.ToolCall) as any;
    // Wire shape, arguments kept as the raw accumulated JSON string.
    expect(toolCall.toolCall).toEqual({
      id: "c1",
      type: ToolCallType.Function,
      function: { name: "search", arguments: '{"q":"paris"}' },
    });
    // tool_call is emitted before done.
    expect(events.map((e) => e.type)).toEqual([StreamEventType.ToolCall, StreamEventType.Done]);
  });

  // Edge: a mid-stream throw becomes an error event with the partial message.
  test("edge: mid-stream failure yields an error with partial content", async () => {
    async function* boom(): AsyncGenerator<ChatChunk> {
      yield chunk({ content: "par" });
      throw new Error("network");
    }
    const events = await collect(chunksToEvents(boom()));
    const last = events.at(-1) as any;
    expect(last.type).toBe(StreamEventType.Error);
    expect(last.error.message).toBe("network");
    expect(last.message.content).toBe("par");
  });
});

describe("OpenAICompatibleModel", () => {
  // Base case: an injected client drives a full stream end to end (no network).
  test("base: streams through an injected client", async () => {
    const fakeClient = {
      chat: { completions: { create: async () => stream(chunk({ content: "hi" })) } },
    } as unknown as OpenAI;

    const model = new OpenAICompatibleModel({ model: "m", client: fakeClient });
    const events = await collect(model.stream({ messages: [{ role: Role.User, content: "q" }] }));
    expect(events.map((e) => e.type)).toEqual([StreamEventType.TextDelta, StreamEventType.Done]);
    expect((events.at(-1) as any).message.content).toBe("hi");
  });

  // Edge: a create() failure surfaces as an error event, not a throw.
  test("edge: a create failure becomes an error event", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => {
            throw new Error("401");
          },
        },
      },
    } as unknown as OpenAI;

    const model = new OpenAICompatibleModel({ model: "m", client: fakeClient });
    const events = await collect(model.stream({ messages: [{ role: Role.User, content: "q" }] }));
    expect(events).toHaveLength(1);
    expect((events[0] as any).type).toBe(StreamEventType.Error);
  });
});

describe("drainLines (raw SSE tap)", () => {
  function streamOf(text: string): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  // Base case: emits one callback per non-empty line, blanks skipped.
  test("base: splits SSE text into non-empty lines", async () => {
    const lines: string[] = [];
    await drainLines(streamOf("data: a\ndata: b\n\ndata: [DONE]\n"), (l) => lines.push(l));
    expect(lines).toEqual(["data: a", "data: b", "data: [DONE]"]);
  });

  // Edge: a line split across two byte chunks is reassembled.
  test("edge: reassembles a line split across reads", async () => {
    const lines: string[] = [];
    const enc = new TextEncoder();
    const split = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode("data: hel"));
        controller.enqueue(enc.encode("lo\n"));
        controller.close();
      },
    });
    await drainLines(split, (l) => lines.push(l));
    expect(lines).toEqual(["data: hello"]);
  });
});
