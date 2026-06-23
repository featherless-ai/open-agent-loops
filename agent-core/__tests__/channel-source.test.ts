import { describe, expect, test } from "bun:test";
import { ChannelBridge } from "../channels/channel-bridge";
import { InMemoryChannelSource } from "../channels/in-memory-channel-source";
import type { DispatcherRunBase } from "../channels/dispatcher.types";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import { Role } from "../types";

// A macrotask flush: lets a full runAgent (mock model + in-RAM memory, all
// microtasks) settle before assertions.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("InMemoryChannelSource", () => {
  // Base: emit delivers to the started handler; send records the reply.
  test("delivers emitted messages to the handler and records sends", () => {
    const source = new InMemoryChannelSource();
    const seen: string[] = [];
    source.start((m) => seen.push(m.text));

    source.emit({ channelId: "C", threadId: "T", userId: "U", text: "hi" });
    source.send({ channelId: "C", threadId: "T" }, "yo");

    expect(seen).toEqual(["hi"]);
    expect(source.sent).toEqual([{ target: { channelId: "C", threadId: "T" }, text: "yo" }]);
  });

  // Edge: emitting before start is a hard error (fail fast).
  test("emit before start throws", () => {
    expect(() => new InMemoryChannelSource().emit({ channelId: "C", userId: "U", text: "x" })).toThrow();
  });
});

describe("ChannelBridge", () => {
  const base = (model: MockModelClient, memory = new SessionMemoryStore()): DispatcherRunBase => ({
    model,
    memory,
  });

  // End-to-end: an inbound message drives a run and the reply is posted back to
  // the originating channel/thread, coalesced from the streamed deltas.
  test("routes an inbound message through runAgent and posts the reply back", async () => {
    const source = new InMemoryChannelSource();
    const model = new MockModelClient([{ text: "hello back" }]);
    const bridge = new ChannelBridge({ source, base: base(model) });
    await bridge.start();

    source.emit({ channelId: "C1", threadId: "T1", userId: "U1", text: "hello there" });
    await tick();

    expect(source.sent).toEqual([
      { target: { channelId: "C1", threadId: "T1" }, text: "hello back" },
    ]);
  });

  // Thread → session: two messages on the same thread share a session, so the
  // second run's request carries the first turn's history (Memory reuse).
  test("maps a thread to one session so history accrues across messages", async () => {
    const source = new InMemoryChannelSource();
    const model = new MockModelClient([{ text: "first reply" }, { text: "second reply" }]);
    const bridge = new ChannelBridge({ source, base: base(model) });
    await bridge.start();

    source.emit({ channelId: "C", threadId: "T", userId: "U", text: "one" });
    await tick();
    source.emit({ channelId: "C", threadId: "T", userId: "U", text: "two" });
    await tick();

    expect(source.sent.map((s) => s.text)).toEqual(["first reply", "second reply"]);

    // The second run's request includes the whole thread so far.
    const lastRequest = model.requests.at(-1)!;
    const userTexts = lastRequest.messages.filter((m) => m.role === Role.User).map((m) => m.content);
    expect(userTexts).toEqual(["one", "two"]);
  });

  // Different threads → different sessions → separate replies to separate targets.
  test("keeps separate threads isolated", async () => {
    const source = new InMemoryChannelSource();
    const model = new MockModelClient([{ text: "to A" }, { text: "to B" }]);
    const bridge = new ChannelBridge({ source, base: base(model), maxConcurrency: 1 });
    await bridge.start();

    source.emit({ channelId: "C", threadId: "A", userId: "U", text: "ping A" });
    await tick();
    source.emit({ channelId: "C", threadId: "B", userId: "U", text: "ping B" });
    await tick();

    expect(source.sent).toEqual([
      { target: { channelId: "C", threadId: "A" }, text: "to A" },
      { target: { channelId: "C", threadId: "B" }, text: "to B" },
    ]);
  });

  // Backpressure is observable through the dispatcher the bridge owns.
  test("exposes dispatcher stats for backpressure observability", async () => {
    const source = new InMemoryChannelSource();
    const model = new MockModelClient([{ text: "ok" }]);
    const bridge = new ChannelBridge({ source, base: base(model) });
    await bridge.start();

    source.emit({ channelId: "C", threadId: "T", userId: "U", text: "go" });
    await tick();

    const stats = bridge.dispatcher.stats();
    expect(stats.sessions).toBe(1);
    expect(stats.queued).toBe(0); // drained by now
    expect(stats.dropped).toBe(0);
  });
});
