import { describe, expect, test } from "bun:test";
import { agentAsTool } from "../tools/agent-as-tool";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import type { RunAgentOptions, RunResult } from "../primitives/loop";
import { AgentEventType, assistantMessage, contentToText } from "../types";
import type { AgentEvent } from "../types";

/** A RunResult whose latest assistant output is `text`. */
const resultWith = (text: string): RunResult => {
  const am = assistantMessage({ content: text });
  return { messages: [am], newMessages: [am], steps: 1 };
};

/** A controllable run function that records each call and returns a canned result. */
function recordingRun(result: RunResult) {
  const calls: RunAgentOptions[] = [];
  const run = async (opts: RunAgentOptions): Promise<RunResult> => {
    calls.push(opts);
    return result;
  };
  return { run, calls };
}

describe("agentAsTool", () => {
  // The factory advertises the caller's name/description and a single `task` arg.
  test("exposes the given name, description, and a task parameter", () => {
    const tool = agentAsTool({
      name: "researcher",
      description: "Researches a question and reports back.",
      model: new MockModelClient([]),
    });

    expect(tool.name).toBe("researcher");
    expect(tool.description).toBe("Researches a question and reports back.");
    expect(tool.parameters.safeParse({ task: "find X" }).success).toBe(true);
    expect(tool.parameters.safeParse({}).success).toBe(false);
  });

  // End-to-end over a real runAgent: the model's `task` becomes the child prompt,
  // and the child's final assistant text comes back as the tool result.
  test("runs the child with the task as its prompt and returns the final text", async () => {
    const model = new MockModelClient([{ text: "the sub-agent answer" }]);
    const tool = agentAsTool({ name: "researcher", description: "d", model });

    const res = await tool.execute({ task: "find the answer" }, { toolCallId: "call_1" });

    expect(res.content).toBe("the sub-agent answer");
    const prompt = contentToText(model.requests[0]!.messages.at(-1)!.content);
    expect(prompt).toContain("find the answer");
  });

  // The tool wires the call's task/sessionId/signal/memory into the child run.
  test("forwards task, a per-call sessionId, the signal, and a memory to the child", async () => {
    const h = recordingRun(resultWith("ok"));
    const controller = new AbortController();
    const tool = agentAsTool({
      name: "researcher",
      description: "d",
      model: new MockModelClient([]),
      run: h.run,
    });

    await tool.execute(
      { task: "do the thing" },
      { toolCallId: "call_42", signal: controller.signal },
    );

    const call = h.calls[0]!;
    expect(call.prompt).toBe("do the thing");
    expect(call.sessionId).toBe("researcher:call_42"); // isolated + traceable per call
    expect(call.signal).toBe(controller.signal); // parent abort cancels the child
    expect(call.memory).toBeInstanceOf(SessionMemoryStore); // fresh store by default
  });

  // Default isolation: each call runs in a fresh session, so an earlier call's task
  // is invisible to a later one.
  test("isolates each call in a fresh session by default", async () => {
    const model = new MockModelClient([{ text: "a1" }, { text: "a2" }]);
    const tool = agentAsTool({ name: "r", description: "d", model });

    await tool.execute({ task: "first task" }, { toolCallId: "c1" });
    await tool.execute({ task: "second task" }, { toolCallId: "c2" });

    const req2 = model.requests[1]!.messages.map((m) => contentToText(m.content)).join("\n");
    expect(req2).toContain("second task");
    expect(req2).not.toContain("first task");
  });

  // Continuity opt-in: a shared memory + stable sessionId retains history across calls.
  test("retains history across calls when given a memory and sessionId", async () => {
    const model = new MockModelClient([{ text: "a1" }, { text: "a2" }]);
    const tool = agentAsTool({
      name: "r",
      description: "d",
      model,
      memory: new SessionMemoryStore(),
      sessionId: "shared",
    });

    await tool.execute({ task: "first task" }, { toolCallId: "c1" });
    await tool.execute({ task: "second task" }, { toolCallId: "c2" });

    const req2 = model.requests[1]!.messages.map((m) => contentToText(m.content)).join("\n");
    expect(req2).toContain("first task"); // prior turn retained
    expect(req2).toContain("second task");
  });

  // A custom resultFrom fully owns how the result text is shaped.
  test("honors a custom resultFrom", async () => {
    const h = recordingRun({ messages: [], newMessages: [], steps: 3 });
    const tool = agentAsTool({
      name: "r",
      description: "d",
      model: new MockModelClient([]),
      run: h.run,
      resultFrom: (r) => `took ${r.steps} steps`,
    });

    const res = await tool.execute({ task: "x" }, { toolCallId: "c1" });
    expect(res.content).toBe("took 3 steps");
  });

  // A run that produces no assistant text yields a clear placeholder, never "".
  test("returns a clear placeholder when the sub-agent produced no text", async () => {
    const h = recordingRun({ messages: [], newMessages: [], steps: 1 });
    const tool = agentAsTool({
      name: "researcher",
      description: "d",
      model: new MockModelClient([]),
      run: h.run,
    });

    const res = await tool.execute({ task: "x" }, { toolCallId: "c1" });
    expect(res.content).not.toBe("");
    expect(res.content).toContain("researcher");
  });

  // The full child RunResult rides `details` (for hooks/tracer), never the model.
  test("carries the child RunResult on details", async () => {
    const result = resultWith("answer");
    const h = recordingRun(result);
    const tool = agentAsTool({
      name: "researcher",
      description: "d",
      model: new MockModelClient([]),
      run: h.run,
    });

    const res = await tool.execute({ task: "x" }, { toolCallId: "call_9" });
    expect(res.details).toMatchObject({ sessionId: "researcher:call_9", steps: 1 });
    expect((res.details as { result: RunResult }).result).toBe(result);
  });

  // The child's event stream forwards through the child's own onEvent — the caller's
  // closure attributes them (no event-schema change yet).
  test("forwards child events to onEvent", async () => {
    const events: AgentEvent[] = [];
    const model = new MockModelClient([{ text: "done" }]);
    const tool = agentAsTool({
      name: "r",
      description: "d",
      model,
      onEvent: (e) => {
        events.push(e);
      },
    });

    await tool.execute({ task: "x" }, { toolCallId: "c1" });

    expect(events.some((e) => e.type === AgentEventType.AgentStart)).toBe(true);
    expect(events.some((e) => e.type === AgentEventType.AgentEnd)).toBe(true);
  });
});
