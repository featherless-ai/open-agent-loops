import { describe, expect, test } from "bun:test";
import { FakeModelClient } from "../mocks/fake-model";
import type { ModelRequest, StreamEvent } from "../model.types";

const req: ModelRequest = { messages: [{ role: "user", content: "hi" }] };

/** Drain a stream into an array of events for inspection. */
async function collect(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("FakeModelClient", () => {
  // Base case: text streams as multiple deltas and ends with `done`.
  test("base: streams text in chunks by default and finishes with done", async () => {
    const model = new FakeModelClient([{ text: "hello world" }], { chunkSize: 4 });
    const events = await collect(model.stream(req));

    const deltas = events.filter((e) => e.type === "text_delta");
    expect(deltas.length).toBeGreaterThan(1); // proves it actually streamed
    expect(deltas.map((e) => (e as any).text).join("")).toBe("hello world");

    const done = events.at(-1);
    expect(done?.type).toBe("done");
    expect((done as any).message.content).toBe("hello world");
  });

  // Edge: chunkSize Infinity emits the text as a single delta.
  test("edge: chunkSize Infinity emits one delta", async () => {
    const model = new FakeModelClient([{ text: "abcdef" }], { chunkSize: Infinity });
    const deltas = (await collect(model.stream(req))).filter((e) => e.type === "text_delta");
    expect(deltas).toHaveLength(1);
  });

  // Edge: an empty-text turn emits no deltas but still completes.
  test("edge: empty text yields no deltas but still emits done", async () => {
    const model = new FakeModelClient([{ text: "" }]);
    const events = await collect(model.stream(req));
    expect(events.filter((e) => e.type === "text_delta")).toHaveLength(0);
    expect(events.at(-1)?.type).toBe("done");
  });

  // Edge: scripted reasoning streams as reasoning_delta before the text.
  test("edge: reasoning streams ahead of content and lands on the message", async () => {
    const model = new FakeModelClient([{ reasoning: "thinking", text: "answer" }], {
      chunkSize: 4,
    });
    const events = await collect(model.stream(req));

    const reasoningDeltas = events.filter((e) => e.type === "reasoning_delta");
    expect(reasoningDeltas.length).toBeGreaterThan(1); // streamed in chunks
    expect(reasoningDeltas.map((e) => (e as any).text).join("")).toBe("thinking");

    // All reasoning is emitted before any text delta.
    const firstText = events.findIndex((e) => e.type === "text_delta");
    const lastReasoning = events.map((e) => e.type).lastIndexOf("reasoning_delta");
    expect(lastReasoning).toBeLessThan(firstText);

    expect((events.at(-1) as any).message.reasoning).toBe("thinking");
  });

  // Edge: a turn without reasoning emits no reasoning_delta and omits the field.
  test("edge: no reasoning means no reasoning_delta and no field", async () => {
    const model = new FakeModelClient([{ text: "plain" }]);
    const events = await collect(model.stream(req));
    expect(events.some((e) => e.type === "reasoning_delta")).toBe(false);
    expect((events.at(-1) as any).message.reasoning).toBeUndefined();
  });

  // Edge: tool calls are streamed and missing ids are auto-assigned.
  test("edge: tool calls are emitted with auto-generated ids", async () => {
    const model = new FakeModelClient([
      { toolCalls: [{ name: "search", arguments: { q: "x" } }] },
    ]);
    const events = await collect(model.stream(req));
    const toolCall = events.find((e) => e.type === "tool_call") as any;
    expect(toolCall.toolCall.function.name).toBe("search");
    expect(typeof toolCall.toolCall.id).toBe("string");
    expect(toolCall.toolCall.id.length).toBeGreaterThan(0);
  });

  // Edge: the function form can branch on the request and call index.
  test("edge: function script can react to the request", async () => {
    const model = new FakeModelClient((request, index) => ({
      text: `call ${index} saw ${request.messages.length} msg(s)`,
    }));
    const done = (await collect(model.stream(req))).at(-1) as any;
    expect(done.message.content).toBe("call 0 saw 1 msg(s)");
  });

  // Edge: an error turn surfaces an `error` event instead of `done`.
  test("edge: error turns emit an error event", async () => {
    const model = new FakeModelClient([{ text: "partial", error: "boom" }]);
    const events = await collect(model.stream(req));
    const last = events.at(-1) as any;
    expect(last.type).toBe("error");
    expect(last.error.message).toBe("boom");
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  // Edge: running past the end of an array script throws a clear error.
  test("edge: exhausting the script throws", async () => {
    const model = new FakeModelClient([{ text: "only one" }]);
    await collect(model.stream(req));
    expect(() => model.stream(req)).toThrow(/no scripted turn/);
  });

  // Edge: every request is captured for assertions.
  test("edge: requests are recorded in order", async () => {
    const model = new FakeModelClient([{ text: "a" }, { text: "b" }]);
    await collect(model.stream({ messages: [{ role: "user", content: "first" }] }));
    await collect(model.stream({ messages: [{ role: "user", content: "second" }] }));
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]!.messages[0]!.content).toBe("second");
  });
});
