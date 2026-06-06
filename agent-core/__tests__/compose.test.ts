import { describe, expect, test } from "bun:test";
import { withMemoryNamespace, withModelObserver } from "../compose";
import { InMemoryStore } from "../memory";
import { runAgent } from "../loop";
import type { ModelClient, StreamEvent } from "../model";
import type { Memory } from "../memory";
import type { Message } from "../types";

/**
 * A ModelClient implemented as a plain object — no factory, no class. This is
 * the "implement the interface inline" pattern the SDK favors.
 */
const helloModel: ModelClient = {
  stream: () =>
    (async function* (): AsyncGenerator<StreamEvent> {
      yield { type: "text_delta", text: "hi" };
      yield { type: "done", message: { role: "assistant", content: "hi" } };
    })(),
};

describe("plain-object seams (no factory needed)", () => {
  // Base case: an inline ModelClient object drives a run.
  test("base: an inline ModelClient object works with runAgent", async () => {
    const result = await runAgent({
      model: helloModel,
      memory: new InMemoryStore(),
      sessionId: "s",
      prompt: "q",
    });
    expect(result.messages.at(-1)?.content).toBe("hi");
  });

  // Base case: an inline Memory object works too.
  test("base: an inline Memory object satisfies the seam", async () => {
    const map = new Map<string, Message[]>();
    const memory: Memory = {
      load: async (id) => map.get(id) ?? [],
      append: async (id, msgs) => void map.set(id, [...(map.get(id) ?? []), ...msgs]),
      clear: async (id) => void map.delete(id),
    };
    await memory.append("s", [{ role: "user", content: "x" }]);
    expect((await memory.load("s")).map((m) => m.content)).toEqual(["x"]);
  });
});

describe("withModelObserver", () => {
  // Base case: the observer sees every event the inner model emits.
  test("base: observes all stream events", async () => {
    const seen: string[] = [];
    const model = withModelObserver(helloModel, (e) => seen.push(e.type));
    await runAgent({ model, memory: new InMemoryStore(), sessionId: "s", prompt: "q" });
    expect(seen).toContain("text_delta");
    expect(seen).toContain("done");
  });

  // Edge: the decorator is transparent — output is unchanged.
  test("edge: wrapping does not alter the result", async () => {
    const plain = await runAgent({
      model: helloModel,
      memory: new InMemoryStore(),
      sessionId: "s",
      prompt: "q",
    });
    const wrapped = await runAgent({
      model: withModelObserver(helloModel, () => {}),
      memory: new InMemoryStore(),
      sessionId: "s",
      prompt: "q",
    });
    expect(wrapped.messages.at(-1)?.content).toBe(plain.messages.at(-1)?.content);
  });

  // Edge: decorators stack — wrapping twice runs both observers.
  test("edge: observers compose when stacked", async () => {
    const a: string[] = [];
    const b: string[] = [];
    const model = withModelObserver(
      withModelObserver(helloModel, (e) => a.push(e.type)),
      (e) => b.push(e.type),
    );
    await runAgent({ model, memory: new InMemoryStore(), sessionId: "s", prompt: "q" });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe("withMemoryNamespace", () => {
  // Base case: reads/writes go through the prefixed key on the base store.
  test("base: namespacing prefixes the underlying session id", async () => {
    const base = new InMemoryStore();
    const ns = withMemoryNamespace(base, "tenantA");
    await ns.append("s", [{ role: "user", content: "hello" }]);

    expect((await base.load("tenantA:s")).map((m) => m.content)).toEqual(["hello"]);
    expect(await base.load("s")).toEqual([]);
  });

  // Edge: two namespaces over one store stay isolated.
  test("edge: separate namespaces do not collide", async () => {
    const base = new InMemoryStore();
    const a = withMemoryNamespace(base, "a");
    const b = withMemoryNamespace(base, "b");
    await a.append("s", [{ role: "user", content: "from-a" }]);
    await b.append("s", [{ role: "user", content: "from-b" }]);
    expect((await a.load("s"))[0]?.content).toBe("from-a");
    expect((await b.load("s"))[0]?.content).toBe("from-b");
  });

  // Edge: clear only affects the namespaced session.
  test("edge: clear is scoped to the namespace", async () => {
    const base = new InMemoryStore();
    const a = withMemoryNamespace(base, "a");
    await a.append("s", [{ role: "user", content: "x" }]);
    await a.clear("s");
    expect(await a.load("s")).toEqual([]);
  });
});
