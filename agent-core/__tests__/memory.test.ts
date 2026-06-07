import { describe, expect, test } from "bun:test";
import { SessionMemoryStore } from "../memory/session-memory";
import type { Message } from "../types";

const msg = (content: string): Message => ({ role: "user", content });

describe("SessionMemoryStore", () => {
  // Base case: what you append is what you load back, in order.
  test("base: append then load returns the messages in order", async () => {
    const store = new SessionMemoryStore();
    await store.append("s1", [msg("a"), msg("b")]);
    const loaded = await store.load("s1");
    expect(loaded.map((m) => m.content)).toEqual(["a", "b"]);
  });

  // Edge: an unknown session is empty, not an error.
  test("edge: loading an unknown session yields an empty array", async () => {
    const store = new SessionMemoryStore();
    expect(await store.load("missing")).toEqual([]);
  });

  // Edge: sessions are isolated from one another.
  test("edge: sessions do not bleed into each other", async () => {
    const store = new SessionMemoryStore();
    await store.append("a", [msg("x")]);
    await store.append("b", [msg("y")]);
    expect((await store.load("a")).map((m) => m.content)).toEqual(["x"]);
    expect((await store.load("b")).map((m) => m.content)).toEqual(["y"]);
  });

  // Edge: appends accumulate across calls rather than replacing.
  test("edge: multiple appends accumulate", async () => {
    const store = new SessionMemoryStore();
    await store.append("s", [msg("1")]);
    await store.append("s", [msg("2"), msg("3")]);
    expect((await store.load("s")).map((m) => m.content)).toEqual(["1", "2", "3"]);
  });

  // Edge: load returns copies — mutating them must not corrupt the store.
  test("edge: defensive copy prevents external mutation", async () => {
    const store = new SessionMemoryStore();
    await store.append("s", [msg("orig")]);
    const loaded = await store.load("s");
    loaded[0]!.content = "hacked";
    expect((await store.load("s"))[0]!.content).toBe("orig");
  });

  // Edge: the copy is deep — mutating nested tool-call arguments is isolated.
  test("edge: defensive copy reaches nested tool-call arguments", async () => {
    const store = new SessionMemoryStore();
    const assistant: Message = {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "1", name: "search", arguments: { filter: { city: "Paris" } } }],
    };
    await store.append("s", [assistant]);

    const loaded = await store.load("s");
    (loaded[0]!.toolCalls![0]!.arguments.filter as { city: string }).city = "London";

    const reloaded = await store.load("s");
    expect((reloaded[0]!.toolCalls![0]!.arguments.filter as { city: string }).city).toBe("Paris");
  });

  // Edge: clear removes history for a session.
  test("edge: clear empties a session", async () => {
    const store = new SessionMemoryStore();
    await store.append("s", [msg("a")]);
    await store.clear("s");
    expect(await store.load("s")).toEqual([]);
  });
});
