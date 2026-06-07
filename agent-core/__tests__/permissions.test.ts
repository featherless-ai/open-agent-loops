import { describe, expect, test } from "bun:test";
import { permissionGate } from "../permissions/permission-gate";
import { InMemoryPermissionStore } from "../permissions/in-memory-permission-store";
import type {
  ApprovalChoice,
  ApprovalPrompter,
  ApprovalRequest,
} from "../permissions/permissions.types";
import type { ToolGateRequest } from "../primitives/loop";

/** Build a gate request for a tool by name. */
const req = (name: string, args: Record<string, unknown> = {}): ToolGateRequest => ({
  toolCall: { id: `id_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
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
  // Base case: a configured "allow" runs without ever prompting.
  test("base: store 'allow' allows without prompting", async () => {
    const store = new InMemoryPermissionStore({ rules: { a: "allow" } });
    const prompter = new ScriptedPrompter([]);
    const [d] = await permissionGate(store, prompter)([req("a")]);
    expect(d?.allow).toBe(true);
    expect(prompter.asked).toEqual([]);
  });

  // Edge: a configured "deny" blocks without prompting.
  test("edge: store 'deny' blocks without prompting", async () => {
    const store = new InMemoryPermissionStore({ rules: { a: "deny" } });
    const prompter = new ScriptedPrompter([]);
    const [d] = await permissionGate(store, prompter)([req("a")]);
    expect(d?.allow).toBe(false);
    expect(prompter.asked).toEqual([]);
  });

  // Edge: "ask" + allow_once allows this time but remembers nothing.
  test("edge: 'ask' + allow_once allows without persisting", async () => {
    const store = new InMemoryPermissionStore(); // fallback "ask"
    const [d] = await permissionGate(store, new ScriptedPrompter(["allow_once"]))([req("a")]);
    expect(d?.allow).toBe(true);
    expect(await store.get("a", {})).toBe("ask");
  });

  // Edge: "ask" + allow_always allows and persists "allow".
  test("edge: 'ask' + allow_always persists allow", async () => {
    const store = new InMemoryPermissionStore();
    const [d] = await permissionGate(store, new ScriptedPrompter(["allow_always"]))([req("a")]);
    expect(d?.allow).toBe(true);
    expect(await store.get("a", {})).toBe("allow");
  });

  // Edge: "ask" + deny_once blocks without persisting.
  test("edge: 'ask' + deny_once blocks without persisting", async () => {
    const store = new InMemoryPermissionStore();
    const [d] = await permissionGate(store, new ScriptedPrompter(["deny_once"]))([req("a")]);
    expect(d?.allow).toBe(false);
    expect(await store.get("a", {})).toBe("ask");
  });

  // Edge: "ask" + deny_always blocks and persists "deny".
  test("edge: 'ask' + deny_always persists deny", async () => {
    const store = new InMemoryPermissionStore();
    const [d] = await permissionGate(store, new ScriptedPrompter(["deny_always"]))([req("a")]);
    expect(d?.allow).toBe(false);
    expect(await store.get("a", {})).toBe("deny");
  });

  // Edge: only the calls whose policy is "ask" are sent to the prompter.
  test("edge: only the 'ask' subset is sent to the prompter", async () => {
    const store = new InMemoryPermissionStore({ rules: { a: "allow", c: "deny" } }); // b is "ask"
    const prompter = new ScriptedPrompter(["allow_once"]);
    const decisions = await permissionGate(store, prompter)([req("a"), req("b"), req("c")]);
    expect(decisions.map((d) => d.allow)).toEqual([true, true, false]);
    expect(prompter.asked.length).toBe(1);
    expect(prompter.asked[0]!.map((r) => r.toolCall.function.name)).toEqual(["b"]);
  });
});

describe("InMemoryPermissionStore", () => {
  // Base case: the fallback applies to tools without an explicit rule.
  test("base: fallback applies to unknown tools", async () => {
    const store = new InMemoryPermissionStore({ fallback: "allow" });
    expect(await store.get("anything", {})).toBe("allow");
  });

  // Edge: seeded rules take precedence over the fallback.
  test("edge: seeded rules win over the fallback", async () => {
    const store = new InMemoryPermissionStore({ fallback: "allow", rules: { danger: "deny" } });
    expect(await store.get("danger", {})).toBe("deny");
    expect(await store.get("other", {})).toBe("allow");
  });

  // Edge: set persists a decision for later reads.
  test("edge: set persists a decision", async () => {
    const store = new InMemoryPermissionStore(); // default "ask"
    await store.set("a", "allow");
    expect(await store.get("a", {})).toBe("allow");
  });
});
