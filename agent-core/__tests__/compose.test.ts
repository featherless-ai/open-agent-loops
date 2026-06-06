import { describe, expect, test } from "bun:test";
import { defineMemory, defineModel, withMemoryNamespace, withModelObserver } from "../compose";
import { InMemoryStore } from "../memory";
import { runAgent } from "../loop";
import type { ModelRequest, StreamEvent } from "../model";
import type { Message } from "../types";

/** A tiny streaming function used to build models without any class. */
const helloStream = (_req: ModelRequest) =>
  (async function* (): AsyncGenerator<StreamEvent> {
    yield { type: "text_delta", text: "hi" };
    yield { type: "done", message: { role: "assistant", content: "hi" } as Message };
  })();

describe("defineModel", () => {
  // Base case: a plain function becomes a working ModelClient (no class).
  test("base: builds a ModelClient from a function and runs", async () => {
    const model = defineModel(helloStream);
    const result = await runAgent({
      model,
      memory: new InMemoryStore(),
      sessionId: "s",
      prompt: "q",
    });
    expect(result.messages.at(-1)?.content).toBe("hi");
  });

  // Edge: the function receives the request it was given.
  test("edge: the stream function sees the request", async () => {
    let seen: ModelRequest | undefined;
    const model = defineModel((req) => {
      seen = req;
      return helloStream(req);
    });
    await runAgent({ model, memory: new InMemoryStore(), sessionId: "s", prompt: "ping" });
    expect(seen?.messages[0]?.content).toBe("ping");
  });
});

describe("defineMemory", () => {
  // Base case: a plain object of functions works as Memory.
  test("base: builds a Memory from functions", async () => {
    const map = new Map<string, Message[]>();
    const memory = defineMemory({
      load: async (id) => map.get(id) ?? [],
      append: async (id, msgs) => {
        map.set(id, [...(map.get(id) ?? []), ...msgs]);
      },
      clear: async (id) => void map.delete(id),
    });
    await memory.append("s", [{ role: "user", content: "x" }]);
    expect((await memory.load("s")).map((m) => m.content)).toEqual(["x"]);
  });
});

describe("withModelObserver", () => {
  // Base case: the observer sees every event the inner model emits.
  test("base: observes all stream events", async () => {
    const seen: string[] = [];
    const model = withModelObserver(defineModel(helloStream), (e) => seen.push(e.type));
    await runAgent({ model, memory: new InMemoryStore(), sessionId: "s", prompt: "q" });
    expect(seen).toContain("text_delta");
    expect(seen).toContain("done");
  });

  // Edge: the decorator is transparent — output is unchanged.
  test("edge: wrapping does not alter the result", async () => {
    const plain = await runAgent({
      model: defineModel(helloStream),
      memory: new InMemoryStore(),
      sessionId: "s",
      prompt: "q",
    });
    const wrapped = await runAgent({
      model: withModelObserver(defineModel(helloStream), () => {}),
      memory: new InMemoryStore(),
      sessionId: "s",
      prompt: "q",
    });
    expect(wrapped.messages.at(-1)?.content).toBe(plain.messages.at(-1)?.content);
  });
});

describe("withMemoryNamespace", () => {
  // Base case: reads/writes go through the prefixed key on the base store.
  test("base: namespacing prefixes the underlying session id", async () => {
    const base = new InMemoryStore();
    const ns = withMemoryNamespace(base, "tenantA");
    await ns.append("s", [{ role: "user", content: "hello" }]);

    // The logical id "s" is stored under "tenantA:s" in the base store.
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
