import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { prepareRequestMessages, runAgent } from "../primitives/loop";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import { defineTool } from "../tools/tools";
import { whenToolCalled } from "../stop/conditions";
import type { AgentEvent, AssistantMessage, Message } from "../types";
import { AgentEventType, assistantMessage, isAssistantMessage, ReasoningFormat, Role, ToolCallType, userMessage } from "../types";
import { ExecutionMode } from "../tools/tools.types";

/** Narrow a message to an assistant turn, or fail the test loudly. */
function asAssistant(message: Message | undefined): AssistantMessage {
  if (!message || !isAssistantMessage(message)) {
    throw new Error("expected an assistant message");
  }
  return message;
}

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
    const model = new MockModelClient([{ text: "the answer" }]);
    const memory = new SessionMemoryStore();
    const result = await runAgent({ model, memory, sessionId: "s", prompt: "q" });

    expect(result.steps).toBe(1);
    expect(result.messages.at(-1)?.content).toBe("the answer");
    // Prompt + assistant were both persisted.
    expect((await memory.load("s")).map((m) => m.role)).toEqual([Role.User, Role.Assistant]);
  });

  // Edge: a tool call drives a second turn (call -> result -> final answer).
  test("edge: a tool call produces a result and a follow-up turn", async () => {
    const model = new MockModelClient([
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
    const toolMsg = result.messages.find((m) => m.role === Role.Tool);
    expect(toolMsg?.content).toBe("echo:hi");
    expect(result.messages.at(-1)?.content).toBe("done");
  });

  // Edge: a model that loops forever is bounded by maxSteps.
  test("edge: maxSteps caps a runaway loop", async () => {
    // Always asks for a tool, never gives a final answer.
    const model = new MockModelClient(() => ({
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
    const model = new MockModelClient([
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
    const model = new MockModelClient(() => ({
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
    const model = new MockModelClient([
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
    const toolMsg = result.messages.find((m) => m.role === Role.Tool);
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
    const model = new MockModelClient([
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
    const toolMsg = result.messages.find((m) => m.role === Role.Tool);
    expect(toolMsg?.isError).toBe(true);
    expect(toolMsg?.content).toBe("kaboom");
  });

  // Edge: afterToolCall can rewrite a result.
  test("edge: afterToolCall can override the result", async () => {
    const model = new MockModelClient([
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
    expect(result.messages.find((m) => m.role === Role.Tool)?.content).toBe("overridden");
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
    const model = new MockModelClient([
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
      toolExecution: ExecutionMode.Sequential,
    });
    // Sequential => A fully completes before B starts.
    expect(log).toEqual(["A-start", "A-end", "B-start", "B-end"]);
  });

  // Edge: transformContext reshapes what the model sees.
  test("edge: transformContext is applied before the model call", async () => {
    const model = new MockModelClient([{ text: "ok" }]);
    await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "secret",
      hooks: {
        transformContext: (messages) =>
          messages.map((m) =>
            typeof m.content === "string" ? { ...m, content: m.content.toUpperCase() } : m,
          ),
      },
    });
    expect(model.requests[0]!.messages[0]!.content).toBe("SECRET");
  });

  // Edge: memory persists across separate runs in the same session.
  test("edge: a second run sees the first run's history", async () => {
    const memory = new SessionMemoryStore();
    const model = new MockModelClient([{ text: "first" }, { text: "second" }]);
    await runAgent({ model, memory, sessionId: "s", prompt: "one" });
    await runAgent({ model, memory, sessionId: "s", prompt: "two" });

    // The 2nd model call should have been handed the full prior history.
    const secondCall = model.requests[1]!.messages.map((m) => m.content);
    expect(secondCall).toEqual(["one", "first", "two"]);
  });

  // Edge: reasoning is accumulated onto the assistant message and streamed.
  test("edge: reasoning_delta is captured on the message and emitted", async () => {
    const reasoningText: string[] = [];
    const model = new MockModelClient([{ reasoning: "let me think", text: "the answer" }]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "q",
      onEvent: (e) => {
        if (e.type === AgentEventType.ReasoningDelta) reasoningText.push(e.text);
      },
    });
    const assistant = asAssistant(result.messages.at(-1));
    expect(assistant.reasoning).toBe("let me think");
    expect(assistant.content).toBe("the answer");
    // The reasoning was also streamed as deltas, distinct from the content.
    expect(reasoningText.join("")).toBe("let me think");
  });

  // Edge: reasoning on a tool-call turn is resent; on a plain turn it is dropped.
  test("edge: conditional resend keeps tool-call reasoning, drops the rest", async () => {
    const model = new MockModelClient([
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
    const secondReqAssistant = model.requests[1]!.messages.find(isAssistantMessage);
    expect(secondReqAssistant?.reasoning).toBe("must call echo");
  });

  // Edge: prepareRequestMessages applies the resend rule purely, no mutation.
  test("edge: prepareRequestMessages strips only no-tool reasoning", () => {
    const input: Message[] = [
      assistantMessage({ content: "a", reasoning: "kept", tool_calls: [{ id: "1", type: ToolCallType.Function, function: { name: "t", arguments: "{}" } }] }),
      assistantMessage({ content: "b", reasoning: "dropped" }),
      userMessage({ content: "c" }),
    ];
    const out = prepareRequestMessages(input);
    expect(asAssistant(out[0]).reasoning).toBe("kept");
    expect(asAssistant(out[1]).reasoning).toBeUndefined();
    // Inputs are not mutated.
    expect(asAssistant(input[1]).reasoning).toBe("dropped");
  });

  // Edge: structured reasoning_details follow the same resend rule as the string.
  test("edge: prepareRequestMessages strips reasoning_details on no-tool turns", () => {
    const block = { id: "r0", format: ReasoningFormat.AnthropicClaudeV1, index: 0, type: "reasoning.text", text: "t" } as const;
    const input: Message[] = [
      assistantMessage({ content: "a", reasoning_details: [block], tool_calls: [{ id: "1", type: ToolCallType.Function, function: { name: "t", arguments: "{}" } }] }),
      assistantMessage({ content: "b", reasoning_details: [block] }),
    ];
    const out = prepareRequestMessages(input);
    // Kept on the tool-call turn (continuity), dropped on the plain turn.
    expect(asAssistant(out[0]).reasoning_details).toEqual([block]);
    expect(asAssistant(out[1]).reasoning_details).toBeUndefined();
    // Input untouched.
    expect(asAssistant(input[1]).reasoning_details).toEqual([block]);
  });

  // Edge: tool_start hands off parsed object args, not the raw JSON string.
  test("edge: tool_start carries parsed object args", async () => {
    let startArgs: unknown;
    const model = new MockModelClient([
      { toolCalls: [{ name: "echo", arguments: { text: "hi" } }] },
      { text: "done" },
    ]);
    await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [echo],
      onEvent: (e) => {
        if (e.type === AgentEventType.ToolStart) startArgs = e.args;
      },
    });
    expect(startArgs).toEqual({ text: "hi" }); // a structured object, not '{"text":"hi"}'
  });

  // Edge: a pre-aborted signal rejects before any model call.
  test("edge: a pre-aborted signal stops before the first turn", async () => {
    const model = new MockModelClient([{ text: "never" }]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      runAgent({
        model,
        memory: new SessionMemoryStore(),
        sessionId: "s",
        prompt: "go",
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(model.requests).toHaveLength(0); // never reached the model
  });

  // Edge: aborting during a tool halts the run before the next model call.
  test("edge: aborting during a tool stops the run", async () => {
    const controller = new AbortController();
    const stop = defineTool({
      name: "stop",
      description: "Aborts the run",
      parameters: z.object({}),
      execute: () => {
        controller.abort();
        return { content: "ok" };
      },
    });
    const model = new MockModelClient([
      { toolCalls: [{ name: "stop", arguments: {} }] },
      { text: "should not be reached" },
    ]);
    await expect(
      runAgent({
        model,
        memory: new SessionMemoryStore(),
        sessionId: "s",
        prompt: "go",
        tools: [stop],
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    // Only the first turn ran; the abort prevented a second model call.
    expect(model.requests).toHaveLength(1);
  });

  // Edge: lifecycle events are emitted around the run.
  test("edge: emits agent_start, turn_start, and agent_end", async () => {
    const events: AgentEvent[] = [];
    const model = new MockModelClient([{ text: "ok" }]);
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
    expect(types[0]).toBe(AgentEventType.AgentStart);
    expect(types).toContain(AgentEventType.TurnStart);
    expect(types.at(-1)).toBe(AgentEventType.AgentEnd);
  });

  // Edge: a steering message drained after a tool batch redirects the run — it's
  // appended (after the tool result, pairing intact), the model sees it next
  // turn, and a `message_injected` event marks it.
  test("edge: drainSteering injects after a tool batch and drives another turn", async () => {
    const model = new MockModelClient([
      { toolCalls: [{ name: "echo", arguments: { text: "a" } }] },
      { text: "redirected" },
    ]);
    const queue = [userMessage({ content: "actually do B" })];
    const events: AgentEvent[] = [];

    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [echo],
      hooks: { drainSteering: () => queue.splice(0) },
      onEvent: (e) => {
        events.push(e);
      },
    });

    expect(result.steps).toBe(2);
    expect(result.messages.at(-1)?.content).toBe("redirected");

    // The steering turn lands after the tool result, not before it.
    const roles = result.messages.map((m) => m.role);
    expect(roles).toEqual([Role.User, Role.Assistant, Role.Tool, Role.User, Role.Assistant]);

    // The model actually saw the steering message on the next turn.
    expect(
      model.requests[1]!.messages.some((m) => m.role === Role.User && m.content === "actually do B"),
    ).toBe(true);

    // It was emitted as a labeled injection event, not a plain message.
    const injected = events.find((e) => e.type === AgentEventType.MessageInjected);
    expect(injected).toMatchObject({ origin: "steering" });
    expect(injected && injected.type === AgentEventType.MessageInjected && injected.message.content).toBe(
      "actually do B",
    );
  });

  // Edge: a follow-up drained at the natural stop continues the run in place
  // (one run, monotonic steps) rather than letting it end.
  test("edge: drainFollowUp continues the run past a natural stop", async () => {
    const model = new MockModelClient([{ text: "done" }, { text: "and the summary" }]);
    const queue = [userMessage({ content: "also summarize" })];
    const memory = new SessionMemoryStore();
    const events: AgentEvent[] = [];

    const result = await runAgent({
      model,
      memory,
      sessionId: "s",
      prompt: "go",
      hooks: { drainFollowUp: () => queue.splice(0) },
      onEvent: (e) => {
        events.push(e);
      },
    });

    expect(result.steps).toBe(2);
    expect(result.messages.at(-1)?.content).toBe("and the summary");
    // The follow-up was persisted to history like a normal turn.
    expect((await memory.load("s")).some((m) => m.content === "also summarize")).toBe(true);
    expect(events.find((e) => e.type === AgentEventType.MessageInjected)).toMatchObject({
      origin: "follow_up",
    });
  });

  // Edge: steering is an explicit redirect, so it outranks a tool that asked to
  // terminate — the run takes another turn instead of stopping.
  test("edge: steering overrides a terminating tool", async () => {
    const stop = defineTool({
      name: "stop",
      description: "Stop the run",
      parameters: z.object({}),
      execute: () => ({ content: "stopped", terminate: true }),
    });
    const model = new MockModelClient([{ toolCalls: [{ name: "stop" }] }, { text: "after steer" }]);
    const queue = [userMessage({ content: "keep going" })];

    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [stop],
      hooks: { drainSteering: () => queue.splice(0) },
    });

    expect(result.steps).toBe(2);
    expect(result.messages.at(-1)?.content).toBe("after steer");
  });

  // Edge: the maxSteps cap outranks the queues — neither is even drained once the
  // cap is reached, so a still-full queue survives instead of running uncapped.
  test("edge: maxSteps caps follow-up and leaves the queue undrained at the cap", async () => {
    const model = new MockModelClient(() => ({ text: "more" })); // natural stop every turn
    let drains = 0;

    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      maxSteps: 3,
      hooks: {
        drainFollowUp: () => {
          drains += 1;
          return [userMessage({ content: "keep going" })];
        },
      },
    });

    expect(result.steps).toBe(3);
    // Drained on steps 1 and 2 (steps < maxSteps); skipped on step 3 (at the cap).
    expect(drains).toBe(2);
  });
});
