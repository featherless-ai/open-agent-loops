import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import {
  OpenAICompatibleModel,
  chunksToEvents,
  drainLines,
  toChatMessages,
} from "../providers/openai-compatible";
import type { StreamEvent } from "../model.types";
import { StreamEventType } from "../model.types";
import { FinishReason, ReasoningFormat, Role, ToolCallType } from "../types";

type ChatChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

/** Build a minimal streaming chunk carrying a single choice delta. */
function chunk(delta: Record<string, unknown>, finishReason: string | null = null): ChatChunk {
  return {
    id: "c",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
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

  // Edge: structured reasoning blocks stream by index and are kept verbatim.
  test("edge: reasoning_details accumulate by index, verbatim, with display deltas", async () => {
    const events = await collect(
      chunksToEvents(
        stream(
          chunk({ reasoning_details: [{ type: "reasoning.text", index: 0, format: "anthropic-claude-v1", id: "r0", text: "step " }] }),
          chunk({ reasoning_details: [{ type: "reasoning.text", index: 0, text: "one", signature: "sig" }] }),
          chunk({ content: "answer" }),
        ),
      ),
    );
    // The human-readable text surfaces as reasoning deltas for display.
    const reasoningDeltas = events.filter((e) => e.type === StreamEventType.ReasoningDelta).map((e) => (e as any).text);
    expect(reasoningDeltas).toEqual(["step ", "one"]);
    const done = events.at(-1) as any;
    // Flattened view for inspection.
    expect(done.message.reasoning).toBe("step one");
    // Verbatim structured block, body concatenated, signature + metadata kept.
    expect(done.message.reasoning_details).toEqual([
      { id: "r0", format: ReasoningFormat.AnthropicClaudeV1, index: 0, type: "reasoning.text", text: "step one", signature: "sig" },
    ]);
  });

  // Edge: an encrypted block is preserved but contributes no display text.
  test("edge: encrypted reasoning block is opaque, no display delta", async () => {
    const events = await collect(
      chunksToEvents(stream(chunk({ reasoning_details: [{ type: "reasoning.encrypted", index: 0, data: "AQID" }] }), chunk({ content: "x" }))),
    );
    expect(events.some((e) => e.type === StreamEventType.ReasoningDelta)).toBe(false);
    const done = events.at(-1) as any;
    expect(done.message.reasoning).toBeUndefined();
    expect(done.message.reasoning_details).toEqual([
      { id: null, format: ReasoningFormat.AnthropicClaudeV1, index: 0, type: "reasoning.encrypted", data: "AQID" },
    ]);
  });

  // Edge: finish_reason is captured onto the message and the Done event.
  test("edge: finish_reason surfaces on the done event and message", async () => {
    const events = await collect(chunksToEvents(stream(chunk({ content: "hi" }), chunk({}, "length"))));
    const done = events.at(-1) as any;
    expect(done.type).toBe(StreamEventType.Done);
    expect(done.finishReason).toBe(FinishReason.Length);
    expect(done.message.finishReason).toBe(FinishReason.Length);
  });

  // Edge: a stream that produces nothing usable is an error, not a blank done.
  test("edge: empty stream yields an error, not a blank done", async () => {
    const events = await collect(chunksToEvents(stream(chunk({ role: "assistant" }), chunk({}, "stop"))));
    const last = events.at(-1) as any;
    expect(last.type).toBe(StreamEventType.Error);
    expect(last.error.message).toBe("Model returned an empty message (finish_reason: stop)");
    expect(last.message.content).toBe("");
    // No done event slips out alongside the error.
    expect(events.some((e) => e.type === StreamEventType.Done)).toBe(false);
  });

  // Edge: whitespace-only content with no other signal is still treated as blank.
  test("edge: whitespace-only content is treated as blank", async () => {
    const events = await collect(chunksToEvents(stream(chunk({ content: "  \n" }))));
    expect((events.at(-1) as any).type).toBe(StreamEventType.Error);
  });

  // Edge: reasoning alone keeps the turn alive — it is not blank.
  test("edge: reasoning-only turn is not blank", async () => {
    const events = await collect(chunksToEvents(stream(chunk({ reasoning: "think" }), chunk({}, "stop"))));
    expect((events.at(-1) as any).type).toBe(StreamEventType.Done);
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

  // Edge: chatTemplateKwargs is forwarded in the request body when set.
  test("edge: forwards chat_template_kwargs when configured", async () => {
    let sent: any;
    const fakeClient = {
      chat: {
        completions: {
          create: async (params: any) => {
            sent = params;
            return stream(chunk({ content: "hi" }));
          },
        },
      },
    } as unknown as OpenAI;

    const model = new OpenAICompatibleModel({
      model: "m",
      client: fakeClient,
      chatTemplateKwargs: { enable_thinking: true, clear_thinking: false },
    });
    await collect(model.stream({ messages: [{ role: Role.User, content: "q" }] }));
    expect(sent.chat_template_kwargs).toEqual({ enable_thinking: true, clear_thinking: false });
  });

  // Edge: without the option, no chat_template_kwargs leaks into the request.
  test("edge: omits chat_template_kwargs when not configured", async () => {
    let sent: any;
    const fakeClient = {
      chat: {
        completions: {
          create: async (params: any) => {
            sent = params;
            return stream(chunk({ content: "hi" }));
          },
        },
      },
    } as unknown as OpenAI;

    const model = new OpenAICompatibleModel({ model: "m", client: fakeClient });
    await collect(model.stream({ messages: [{ role: Role.User, content: "q" }] }));
    expect("chat_template_kwargs" in sent).toBe(false);
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

describe("toChatMessages (egress)", () => {
  // Structured reasoning is resent verbatim under reasoning_details.
  test("edge: resends reasoning_details verbatim, not reasoning_content", () => {
    const details = [
      { id: "r0", format: ReasoningFormat.AnthropicClaudeV1, index: 0, type: "reasoning.text" as const, text: "t", signature: "sig" },
    ];
    const out = toChatMessages({
      messages: [{ role: Role.Assistant, content: "", reasoning: "t", reasoning_details: details, tool_calls: [{ id: "c1", type: ToolCallType.Function, function: { name: "x", arguments: "{}" } }] }],
    });
    const assistant = out[0] as any;
    expect(assistant.reasoning_details).toEqual(details);
    expect("reasoning_content" in assistant).toBe(false);
  });

  // Raw-string reasoning falls back to reasoning_content when no blocks exist.
  test("edge: falls back to reasoning_content for raw-string reasoning", () => {
    const out = toChatMessages({
      messages: [{ role: Role.Assistant, content: "", reasoning: "thought", tool_calls: [{ id: "c1", type: ToolCallType.Function, function: { name: "x", arguments: "{}" } }] }],
    });
    const assistant = out[0] as any;
    expect(assistant.reasoning_content).toBe("thought");
    expect("reasoning_details" in assistant).toBe(false);
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
