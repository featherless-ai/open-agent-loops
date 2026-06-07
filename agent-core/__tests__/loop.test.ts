import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { prepareRequestMessages, runAgent } from "../primitives/loop";
import { FakeModelClient } from "../mocks/fake-model";
import { SessionMemoryStore } from "../memory/session-memory";
import { defineTool } from "../tools/tools";
import { whenToolCalled } from "../stop/conditions";
import type { AgentEvent } from "../types";

/** A no-op echo tool used to exercise the tool path. */
const echo = defineTool({
  name: "echo",
  description: "Echo the input",
  parameters: z.object({ text: z.string() }),
  execute: ({ text }) => ({ content: `echo:${text}` }),
});

describe("runAgent", () => {
  // Base case: a turn with no tool calls is the final answer (one step).
  test("base: single turn with no tools returns the final answer", async () => {
    const model = new FakeModelClient([{ text: "the answer" }]);
    const memory = new SessionMemoryStore();
    const result = await runAgent({ model, memory, sessionId: "s", prompt: "q" });

    expect(result.steps).toBe(1);
    expect(result.messages.at(-1)?.content).toBe("the answer");
    // Prompt + assistant were both persisted.
    expect((await memory.load("s")).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  // Edge: a tool call drives a second turn (call -> result -> final answer).
  test("edge: a tool call produces a result and a follow-up turn", async () => {
    const model = new FakeModelClient([
      { toolCalls: [{ name: "echo", arguments: { text: "hi" } }] },
      { text: "done" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [echo],
    });

    expect(result.steps).toBe(2);
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe("echo:hi");
    expect(result.messages.at(-1)?.content).toBe("done");
  });

  // Edge: a model that loops forever is bounded by maxSteps.
  test("edge: maxSteps caps a runaway loop", async () => {
    // Always asks for a tool, never gives a final answer.
    const model = new FakeModelClient(() => ({
      toolCalls: [{ name: "echo", arguments: { text: "x" } }],
    }));
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [echo],
      maxSteps: 3,
    });
    expect(result.steps).toBe(3);
  });

  // Edge: a tool can terminate the run via `terminate: true`.
  test("edge: a terminating tool stops the loop immediately", async () => {
    const finish = defineTool({
      name: "finish",
      description: "End the run",
      parameters: z.object({}),
      execute: () => ({ content: "final", terminate: true }),
    });
    const model = new FakeModelClient([
      { toolCalls: [{ name: "finish", arguments: {} }] },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [finish],
    });
    expect(result.steps).toBe(1);
    expect(result.messages.at(-1)?.content).toBe("final");
  });

  // Edge: a stopWhen condition ends the run after its turn.
  test("edge: stopWhen halts after the named tool runs", async () => {
    const model = new FakeModelClient(() => ({
      toolCalls: [{ name: "echo", arguments: { text: "x" } }],
    }));
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [echo],
      stopWhen: whenToolCalled("echo"),
    });
    expect(result.steps).toBe(1);
  });

  // Edge: an unknown tool becomes an error result instead of crashing.
  test("edge: calling a missing tool yields an error tool-result", async () => {
    const model = new FakeModelClient([
      { toolCalls: [{ name: "nope", arguments: {} }] },
      { text: "recovered" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [echo],
    });
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.isError).toBe(true);
    expect(toolMsg?.content).toMatch(/not found/);
  });

  // Edge: a throwing tool is caught and reported as an error result.
  test("edge: a tool that throws is reported, not propagated", async () => {
    const boom = defineTool({
      name: "boom",
      description: "Always throws",
      parameters: z.object({}),
      execute: () => {
        throw new Error("kaboom");
      },
    });
    const model = new FakeModelClient([
      { toolCalls: [{ name: "boom", arguments: {} }] },
      { text: "ok" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [boom],
    });
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.isError).toBe(true);
    expect(toolMsg?.content).toBe("kaboom");
  });

  // Edge: beforeToolCall can block execution.
  test("edge: beforeToolCall can block a tool", async () => {
    let executed = false;
    const tracked = defineTool({
      name: "echo",
      description: "Echo",
      parameters: z.object({ text: z.string() }),
      execute: ({ text }) => {
        executed = true;
        return { content: text };
      },
    });
    const model = new FakeModelClient([
      { toolCalls: [{ name: "echo", arguments: { text: "x" } }] },
      { text: "after" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [tracked],
      hooks: { beforeToolCall: () => ({ block: true, reason: "denied" }) },
    });
    expect(executed).toBe(false);
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe("denied");
    expect(toolMsg?.isError).toBe(true);
  });

  // Edge: afterToolCall can rewrite a result.
  test("edge: afterToolCall can override the result", async () => {
    const model = new FakeModelClient([
      { toolCalls: [{ name: "echo", arguments: { text: "raw" } }] },
      { text: "end" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [echo],
      hooks: { afterToolCall: () => ({ result: { content: "overridden" } }) },
    });
    expect(result.messages.find((m) => m.role === "tool")?.content).toBe("overridden");
  });

  // Edge: sequential vs parallel execution ordering is observable.
  test("edge: sequential mode runs tools one at a time", async () => {
    const log: string[] = [];
    const make = (name: string) =>
      defineTool({
        name,
        description: name,
        parameters: z.object({}),
        execute: async () => {
          log.push(`${name}-start`);
          await new Promise((r) => setTimeout(r, 1));
          log.push(`${name}-end`);
          return { content: name };
        },
      });
    const model = new FakeModelClient([
      {
        toolCalls: [
          { name: "A", arguments: {} },
          { name: "B", arguments: {} },
        ],
      },
      { text: "fin" },
    ]);
    await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [make("A"), make("B")],
      toolExecution: "sequential",
    });
    // Sequential => A fully completes before B starts.
    expect(log).toEqual(["A-start", "A-end", "B-start", "B-end"]);
  });

  // Edge: transformContext reshapes what the model sees.
  test("edge: transformContext is applied before the model call", async () => {
    const model = new FakeModelClient([{ text: "ok" }]);
    await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "secret",
      hooks: {
        transformContext: (messages) =>
          messages.map((m) => ({ ...m, content: m.content.toUpperCase() })),
      },
    });
    expect(model.requests[0]!.messages[0]!.content).toBe("SECRET");
  });

  // Edge: memory persists across separate runs in the same session.
  test("edge: a second run sees the first run's history", async () => {
    const memory = new SessionMemoryStore();
    const model = new FakeModelClient([{ text: "first" }, { text: "second" }]);
    await runAgent({ model, memory, sessionId: "s", prompt: "one" });
    await runAgent({ model, memory, sessionId: "s", prompt: "two" });

    // The 2nd model call should have been handed the full prior history.
    const secondCall = model.requests[1]!.messages.map((m) => m.content);
    expect(secondCall).toEqual(["one", "first", "two"]);
  });

  // Edge: reasoning is accumulated onto the assistant message and streamed.
  test("edge: reasoning_delta is captured on the message and emitted", async () => {
    const reasoningText: string[] = [];
    const model = new FakeModelClient([{ reasoning: "let me think", text: "the answer" }]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "q",
      onEvent: (e) => {
        if (e.type === "reasoning_delta") reasoningText.push(e.text);
      },
    });
    const assistant = result.messages.at(-1);
    expect(assistant?.reasoning).toBe("let me think");
    expect(assistant?.content).toBe("the answer");
    // The reasoning was also streamed as deltas, distinct from the content.
    expect(reasoningText.join("")).toBe("let me think");
  });

  // Edge: reasoning on a tool-call turn is resent; on a plain turn it is dropped.
  test("edge: conditional resend keeps tool-call reasoning, drops the rest", async () => {
    const model = new FakeModelClient([
      { reasoning: "must call echo", toolCalls: [{ name: "echo", arguments: { text: "x" } }] },
      { reasoning: "now I can answer", text: "done" },
    ]);
    await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [echo],
    });

    // The 2nd request carries the prior tool-call assistant turn — with its
    // reasoning preserved (required for tool-call continuity).
    const secondReqAssistant = model.requests[1]!.messages.find(
      (m) => m.role === "assistant",
    );
    expect(secondReqAssistant?.reasoning).toBe("must call echo");
  });

  // Edge: prepareRequestMessages applies the resend rule purely, no mutation.
  test("edge: prepareRequestMessages strips only no-tool reasoning", () => {
    const input = [
      { role: "assistant" as const, content: "a", reasoning: "kept", toolCalls: [{ id: "1", name: "t", arguments: {} }] },
      { role: "assistant" as const, content: "b", reasoning: "dropped" },
      { role: "user" as const, content: "c" },
    ];
    const out = prepareRequestMessages(input);
    expect(out[0]!.reasoning).toBe("kept");
    expect(out[1]!.reasoning).toBeUndefined();
    // Inputs are not mutated.
    expect(input[1]!.reasoning).toBe("dropped");
  });

  // Edge: lifecycle events are emitted around the run.
  test("edge: emits agent_start, turn_start, and agent_end", async () => {
    const events: AgentEvent[] = [];
    const model = new FakeModelClient([{ text: "ok" }]);
    await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      onEvent: (e) => {
        events.push(e);
      },
    });
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("agent_start");
    expect(types).toContain("turn_start");
    expect(types.at(-1)).toBe("agent_end");
  });
});
