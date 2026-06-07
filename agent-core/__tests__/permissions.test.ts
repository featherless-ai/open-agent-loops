import { describe, expect, test } from "bun:test";
import { permissionGate } from "../permissions/permission-gate";
import { InMemoryPermissionStore } from "../permissions/in-memory-permission-store";
import { ApprovalChoice, PermissionPolicy } from "../permissions/permissions.types";
import type {
  ApprovalPrompter,
  ApprovalRequest,
} from "../permissions/permissions.types";
import type { ToolGateRequest } from "../primitives/loop";
import { ToolCallType } from "../types";

/** Build a gate request for a tool by name. */
const req = (name: string, args: Record<string, unknown> = {}): ToolGateRequest => ({
  toolCall: { id: `id_${name}`, type: ToolCallType.Function, function: { name, arguments: JSON.stringify(args) } },
  args,
});

/** A prompter that replays fixed choices and records what it was asked. */
class ScriptedPrompter implements ApprovalPrompter {
  readonly asked: ApprovalRequest[][] = [];
  constructor(private readonly choices: ApprovalChoice[]) {}
  async ask(batch: ApprovalRequest[]): Promise<ApprovalChoice[]> {
    this.asked.push(batch);
    return batch.map((_, i) => this.choices[i]!);
  }
}

describe("permissionGate", () => {
  // Base case: a configured PermissionPolicy.Allow runs without ever prompting.
  test("base: store 'allow' allows without prompting", async () => {
    const store = new InMemoryPermissionStore({ rules: { a: PermissionPolicy.Allow } });
    const prompter = new ScriptedPrompter([]);
    const [d] = await permissionGate(store, prompter)([req("a")]);
    expect(d?.allow).toBe(true);
    expect(prompter.asked).toEqual([]);
  });

  // Edge: a configured PermissionPolicy.Deny blocks without prompting.
  test("edge: store 'deny' blocks without prompting", async () => {
    const store = new InMemoryPermissionStore({ rules: { a: PermissionPolicy.Deny } });
    const prompter = new ScriptedPrompter([]);
    const [d] = await permissionGate(store, prompter)([req("a")]);
    expect(d?.allow).toBe(false);
    expect(prompter.asked).toEqual([]);
  });

  // Edge: PermissionPolicy.Ask + allow_once allows this time but remembers nothing.
  test("edge: 'ask' + allow_once allows without persisting", async () => {
    const store = new InMemoryPermissionStore(); // fallback PermissionPolicy.Ask
    const [d] = await permissionGate(store, new ScriptedPrompter([ApprovalChoice.AllowOnce]))([req("a")]);
    expect(d?.allow).toBe(true);
    expect(await store.get("a", {})).toBe(PermissionPolicy.Ask);
  });

  // Edge: PermissionPolicy.Ask + allow_always allows and persists PermissionPolicy.Allow.
  test("edge: 'ask' + allow_always persists allow", async () => {
    const store = new InMemoryPermissionStore();
    const [d] = await permissionGate(store, new ScriptedPrompter([ApprovalChoice.AllowAlways]))([req("a")]);
    expect(d?.allow).toBe(true);
    expect(await store.get("a", {})).toBe(PermissionPolicy.Allow);
  });

  // Edge: PermissionPolicy.Ask + deny_once blocks without persisting.
  test("edge: 'ask' + deny_once blocks without persisting", async () => {
    const store = new InMemoryPermissionStore();
    const [d] = await permissionGate(store, new ScriptedPrompter([ApprovalChoice.DenyOnce]))([req("a")]);
    expect(d?.allow).toBe(false);
    expect(await store.get("a", {})).toBe(PermissionPolicy.Ask);
  });

  // Edge: PermissionPolicy.Ask + deny_always blocks and persists PermissionPolicy.Deny.
  test("edge: 'ask' + deny_always persists deny", async () => {
    const store = new InMemoryPermissionStore();
    const [d] = await permissionGate(store, new ScriptedPrompter([ApprovalChoice.DenyAlways]))([req("a")]);
    expect(d?.allow).toBe(false);
    expect(await store.get("a", {})).toBe(PermissionPolicy.Deny);
  });

  // Edge: only the calls whose policy is PermissionPolicy.Ask are sent to the prompter.
  test("edge: only the 'ask' subset is sent to the prompter", async () => {
    const store = new InMemoryPermissionStore({ rules: { a: PermissionPolicy.Allow, c: PermissionPolicy.Deny } }); // b is PermissionPolicy.Ask
    const prompter = new ScriptedPrompter([ApprovalChoice.AllowOnce]);
    const decisions = await permissionGate(store, prompter)([req("a"), req("b"), req("c")]);
    expect(decisions.map((d) => d.allow)).toEqual([true, true, false]);
    expect(prompter.asked.length).toBe(1);
    expect(prompter.asked[0]!.map((r) => r.toolCall.function.name)).toEqual(["b"]);
  });
});

describe("InMemoryPermissionStore", () => {
  // Base case: the fallback applies to tools without an explicit rule.
  test("base: fallback applies to unknown tools", async () => {
    const store = new InMemoryPermissionStore({ fallback: PermissionPolicy.Allow });
    expect(await store.get("anything", {})).toBe(PermissionPolicy.Allow);
  });

  // Edge: seeded rules take precedence over the fallback.
  test("edge: seeded rules win over the fallback", async () => {
    const store = new InMemoryPermissionStore({ fallback: PermissionPolicy.Allow, rules: { danger: PermissionPolicy.Deny } });
    expect(await store.get("danger", {})).toBe(PermissionPolicy.Deny);
    expect(await store.get("other", {})).toBe(PermissionPolicy.Allow);
  });

  // Edge: set persists a decision for later reads.
  test("edge: set persists a decision", async () => {
    const store = new InMemoryPermissionStore(); // default PermissionPolicy.Ask
    await store.set("a", PermissionPolicy.Allow);
    expect(await store.get("a", {})).toBe(PermissionPolicy.Allow);
  });
});
