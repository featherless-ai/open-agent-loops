import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { runAgent } from "../primitives/loop";
import type { GateDecision, ToolGateRequest } from "../primitives/loop";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import { defineTool } from "../tools/tools";
import { permissionGate } from "../permissions/permission-gate";
import { InMemoryPermissionStore } from "../permissions/in-memory-permission-store";
import { PermissionPolicy } from "../permissions/permissions.types";
import { isToolMessage, Role } from "../types";

/** A tool that records each execution, so we can assert it never ran. */
const makeTool = (name: string, ran: string[]) =>
  defineTool({
    name,
    description: name,
    parameters: z.object({ x: z.string() }),
    execute: ({ x }) => {
      ran.push(`${name}:${x}`);
      return { content: `${name}:${x}` };
    },
  });

describe("gateToolCalls (loop integration)", () => {
  // Base case: no gate hook → every call runs as before.
  test("base: no gate hook runs everything", async () => {
    const ran: string[] = [];
    const model = new MockModelClient([
      { toolCalls: [{ name: "a", arguments: { x: "1" } }] },
      { text: "done" },
    ]);
    await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [makeTool("a", ran)],
    });
    expect(ran).toEqual(["a:1"]);
  });

  // Edge: a denied call never executes and becomes an error tool-result, and
  // the loop keeps going so the model can react to the denial.
  test("edge: a denied call is blocked, reported, and the run continues", async () => {
    const ran: string[] = [];
    const model = new MockModelClient([
      { toolCalls: [{ name: "a", arguments: { x: "1" } }] },
      { text: "recovered" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [makeTool("a", ran)],
      hooks: { gateToolCalls: () => [{ allow: false, reason: "nope" }] },
    });
    expect(ran).toEqual([]); // never executed
    const toolMsg = result.messages.find(isToolMessage);
    expect(toolMsg?.isError).toBe(true);
    expect(toolMsg?.content).toBe("nope");
    expect(result.messages.at(-1)?.content).toBe("recovered");
  });

  // Edge: in a mixed batch, allowed calls run, denied ones are blocked, and the
  // tool-results stay in the original call order.
  test("edge: mixed batch — allowed runs, denied blocked, order preserved", async () => {
    const ran: string[] = [];
    const model = new MockModelClient([
      {
        toolCalls: [
          { name: "a", arguments: { x: "1" } },
          { name: "b", arguments: { x: "2" } },
        ],
      },
      { text: "done" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [makeTool("a", ran), makeTool("b", ran)],
      hooks: {
        gateToolCalls: (batch: ToolGateRequest[]): GateDecision[] =>
          batch.map((r) =>
            r.toolCall.function.name === "a" ? { allow: true } : { allow: false, reason: "no b" },
          ),
      },
    });
    expect(ran).toEqual(["a:1"]); // only the allowed tool ran
    const toolMsgs = result.messages.filter(isToolMessage);
    expect(toolMsgs.map((m) => m.toolName)).toEqual(["a", "b"]); // original order
    expect(toolMsgs[0]?.content).toBe("a:1");
    expect(toolMsgs[1]?.isError).toBe(true);
    expect(toolMsgs[1]?.content).toBe("no b");
  });

  // Edge: malformed/unknown calls bypass the gate and fail via the normal path,
  // so the user is never prompted about a call that can't run.
  test("edge: gate sees only well-formed calls; unknown/invalid bypass it", async () => {
    const seen: string[][] = [];
    const ran: string[] = [];
    const model = new MockModelClient([
      {
        toolCalls: [
          { name: "a", arguments: { x: "ok" } }, // well-formed
          { name: "a", arguments: { x: 123 } }, // invalid args
          { name: "ghost", arguments: { x: "1" } }, // unknown tool
        ],
      },
      { text: "done" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [makeTool("a", ran)],
      hooks: {
        gateToolCalls: (batch) => {
          seen.push(batch.map((r) => r.toolCall.function.name));
          return batch.map(() => ({ allow: true }));
        },
      },
    });
    expect(seen).toEqual([["a"]]); // only the well-formed call reached the gate
    const errors = result.messages.filter((m) => m.role === Role.Tool && m.isError);
    expect(errors.length).toBe(2); // invalid + unknown still errored via execute
  });

  // Edge: the gate is consulted once per turn, with the whole batch.
  test("edge: gate runs once per turn with the whole batch", async () => {
    let calls = 0;
    const ran: string[] = [];
    const model = new MockModelClient([
      {
        toolCalls: [
          { name: "a", arguments: { x: "1" } },
          { name: "a", arguments: { x: "2" } },
        ],
      },
      { text: "done" },
    ]);
    await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [makeTool("a", ran)],
      hooks: {
        gateToolCalls: (batch) => {
          calls += 1;
          return batch.map(() => ({ allow: true }));
        },
      },
    });
    expect(calls).toBe(1);
    expect(ran).toEqual(["a:1", "a:2"]);
  });

  // Integration: permissionGate wired in via the hook blocks a "deny" tool.
  test("integration: permissionGate denies a tool configured as deny", async () => {
    const ran: string[] = [];
    const model = new MockModelClient([
      { toolCalls: [{ name: "danger", arguments: { x: "1" } }] },
      { text: "ok" },
    ]);
    const store = new InMemoryPermissionStore({ rules: { danger: PermissionPolicy.Deny } });
    const prompter = { ask: async () => [] }; // never consulted for a "deny" rule
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "go",
      tools: [makeTool("danger", ran)],
      hooks: { gateToolCalls: permissionGate(store, prompter) },
    });
    expect(ran).toEqual([]);
    expect(result.messages.find(isToolMessage)?.isError).toBe(true);
  });
});
