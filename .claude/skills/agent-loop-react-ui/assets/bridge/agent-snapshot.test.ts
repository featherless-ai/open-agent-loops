/**
 * End-to-end verification of the durable bridge: drive a real `runAgent` with a
 * scripted MockModelClient, fold its event stream through the reducer, and assert
 * the snapshot. No network, no UI library — proves Layer B in isolation.
 *
 * Run: bun test .claude/skills/agent-loop-react-ui/assets/bridge/agent-snapshot.test.ts
 */
import { expect, test } from "bun:test";
import { z } from "zod";
import { defineTool, runAgent, SessionMemoryStore, AgentEventType } from "@open-agent-loops/core";
import { MockModelClient } from "@open-agent-loops/core/mocks/mock-model";
import type { AgentEvent } from "@open-agent-loops/core";
import { createSnapshotReducer } from "./agent-snapshot";

const add = defineTool({
  name: "add",
  description: "Add two numbers.",
  parameters: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => ({ content: String(a + b) }),
});

function twoTurnRun() {
  // Turn 1: think, say something, call the tool. Turn 2: final answer.
  const model = new MockModelClient([
    {
      reasoning: "I should add them.",
      text: "Let me add those.",
      toolCalls: [{ id: "call_add_1", name: "add", arguments: { a: 19, b: 23 } }],
    },
    { text: "The sum is 42." },
  ]);
  return model;
}

test("reducer folds a real runAgent stream into a final snapshot", async () => {
  const events: AgentEvent[] = [];
  const reducer = createSnapshotReducer();

  await runAgent({
    model: twoTurnRun(),
    memory: new SessionMemoryStore(),
    sessionId: "snap-test",
    prompt: "What is 19 + 23?",
    tools: [add],
    onEvent: (e) => {
      events.push(e);
      reducer.apply(e);
    },
  });

  const snap = reducer.snapshot();
  expect(snap.status).toBe("done");
  expect(snap.steps).toBe(2);
  // `current` holds the *last* streamed turn — the final answer.
  expect(snap.current.text).toBe("The sum is 42.");
  // The committed log carries every message (prompt, assistant turns, tool result).
  expect(snap.messages.length).toBeGreaterThanOrEqual(3);
});

test("a mid-run snapshot shows the tool call resolving running → complete", () => {
  // Re-fold the captured stream up to the first ToolEnd to inspect the live turn.
  // (Deterministic replay — no model needed.)
  return runAgent({
    model: twoTurnRun(),
    memory: new SessionMemoryStore(),
    sessionId: "snap-test-2",
    prompt: "What is 19 + 23?",
    tools: [add],
    onEvent: () => {},
  }).then(async () => {
    const captured: AgentEvent[] = [];
    await runAgent({
      model: twoTurnRun(),
      memory: new SessionMemoryStore(),
      sessionId: "snap-test-3",
      prompt: "What is 19 + 23?",
      tools: [add],
      onEvent: (e) => captured.push(e),
    });

    const firstToolEnd = captured.findIndex((e) => e.type === AgentEventType.ToolEnd);
    expect(firstToolEnd).toBeGreaterThan(-1);

    const reducer = createSnapshotReducer();
    for (const e of captured.slice(0, firstToolEnd + 1)) reducer.apply(e);

    const snap = reducer.snapshot();
    const call = snap.current.toolCalls.find((c) => c.toolCallId === "call_add_1");
    expect(call).toBeDefined();
    expect(call!.toolName).toBe("add");
    expect(call!.status).toBe("complete");
    expect(call!.result).toBe("42");
    expect(call!.isError).toBe(false);
  });
});
