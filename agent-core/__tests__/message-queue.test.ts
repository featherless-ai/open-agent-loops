import { describe, expect, test } from "bun:test";
import { MessageQueue } from "../primitives/message-queue";
import { runAgent } from "../primitives/loop";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import { userMessage } from "../types";

const u = (content: string) => userMessage({ content });

describe("MessageQueue", () => {
  // Base: default mode releases the oldest single message, FIFO.
  test("base: one-at-a-time drains the oldest message, leaving the rest", () => {
    const q = new MessageQueue();
    q.push(u("a"), u("b"));

    expect(q.size).toBe(2);
    expect(q.drain().map((m) => m.content)).toEqual(["a"]);
    expect(q.size).toBe(1);
    expect(q.drain().map((m) => m.content)).toEqual(["b"]);
    expect(q.size).toBe(0);
  });

  // Edge: "all" mode releases every queued message at once, in FIFO order.
  test("edge: all mode drains everything in order", () => {
    const q = new MessageQueue({ mode: "all" });
    q.push(u("a"));
    q.push(u("b"), u("c"));

    expect(q.drain().map((m) => m.content)).toEqual(["a", "b", "c"]);
    expect(q.size).toBe(0);
  });

  // Edge: draining an empty queue yields [] — safe to pass straight as a hook.
  test("edge: draining empty returns an empty array", () => {
    expect(new MessageQueue().drain()).toEqual([]);
    expect(new MessageQueue({ mode: "all" }).drain()).toEqual([]);
  });

  // Edge: mode is mutable at runtime (pi's steeringMode/followUpMode setter).
  test("edge: switching mode changes how much the next drain releases", () => {
    const q = new MessageQueue();
    q.push(u("a"), u("b"));
    q.mode = "all";
    expect(q.drain().map((m) => m.content)).toEqual(["a", "b"]);
  });

  // Edge: clear drops everything (pi's clear*Queue).
  test("edge: clear empties the queue", () => {
    const q = new MessageQueue();
    q.push(u("a"), u("b"));
    q.clear();
    expect(q.size).toBe(0);
    expect(q.drain()).toEqual([]);
  });

  // Integration: `drain` plugs straight into a loop drain seam — a queued
  // message continues a live run and the queue ends up empty afterward.
  test("integration: plugs into drainFollowUp and continues the run", async () => {
    const q = new MessageQueue();
    q.push(u("also summarize"));
    const model = new MockModelClient([{ text: "first" }, { text: "the summary" }]);

    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      hooks: { drainFollowUp: () => q.drain() },
    });

    expect(result.steps).toBe(2);
    expect(result.messages.at(-1)?.content).toBe("the summary");
    expect(q.size).toBe(0);
  });
});
