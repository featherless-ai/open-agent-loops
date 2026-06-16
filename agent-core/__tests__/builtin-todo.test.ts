import { describe, expect, test } from "bun:test";
import {
  formatTodoList,
  InMemoryTodoStore,
  RETRY_LIMIT,
  todoListTools,
} from "../tools/builtin/todo-list";
import { toToolSpec, validateToolArguments } from "../tools/tools";
import { ExecutionMode } from "../tools/tools.types";
import { runAgent } from "../primitives/loop";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import type { ToolCall } from "../types";
import { isToolMessage, ToolCallType } from "../types";

const ctx = { toolCallId: "c1" };

/** Resolve the three tools by name for clearer test bodies. */
function tools(store = new InMemoryTodoStore()) {
  const [append, list, update] = todoListTools(store);
  return { append: append!, list: list!, update: update!, store };
}

const content = (result: unknown) => (result as { content: string }).content;

describe("InMemoryTodoStore", () => {
  // Base case: an appended item shows up when listed.
  test("base: append then read returns the item", () => {
    const store = new InMemoryTodoStore();
    store.append("a", "first task", "pending");
    expect(store.read(false)).toEqual([
      { id: "a", content: "first task", status: "pending", retries: 0 },
    ]);
  });

  // Edge: a duplicate id is a structural violation and throws.
  test("edge: appending a duplicate id throws", () => {
    const store = new InMemoryTodoStore();
    store.append("a", "first", "pending");
    expect(() => store.append("a", "again", "pending")).toThrow(/already exists/);
  });

  // Edge: an invalid status throws (defense in depth for direct callers).
  test("edge: an invalid status throws", () => {
    const store = new InMemoryTodoStore();
    expect(() => store.append("a", "x", "nope" as never)).toThrow(/Invalid status/);
  });

  // Edge: done and cancelled items are hidden unless explicitly included.
  test("edge: read hides done and cancelled unless includeCompleted", () => {
    const store = new InMemoryTodoStore();
    store.append("a", "done task", "done");
    store.append("b", "cancelled task", "cancelled");
    store.append("c", "live task", "pending");
    expect(store.read(false).map((i) => i.id)).toEqual(["c"]);
    expect(store.read(true).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  // Edge: updating an unknown id throws.
  test("edge: updating an unknown id throws", () => {
    expect(() => new InMemoryTodoStore().update("ghost", undefined, "done")).toThrow(
      /not found/,
    );
  });

  // Edge: moving failed -> in_progress counts as a retry; other moves do not.
  test("edge: failed -> in_progress increments retries", () => {
    const store = new InMemoryTodoStore();
    store.append("a", "x", "pending");
    store.update("a", undefined, "failed");
    expect(store.update("a", undefined, "in_progress").retries).toBe(1);
    // A non-retry transition leaves the count alone.
    store.update("a", undefined, "done");
    store.update("a", undefined, "failed");
    expect(store.update("a", undefined, "in_progress").retries).toBe(2);
  });

  // Edge: returned items are copies — callers can't mutate store state.
  test("edge: read returns copies, not internal references", () => {
    const store = new InMemoryTodoStore();
    store.append("a", "x", "pending");
    store.read(false)[0]!.status = "done";
    expect(store.read(false)[0]!.status).toBe("pending");
  });
});

describe("todoListTools", () => {
  // Base case: the append tool reports what it added.
  test("base: todo_append adds an item and confirms", () => {
    const { append, store } = tools();
    expect(content(append.execute({ id: "a", content: "task", status: "pending" } as never, ctx)))
      .toBe('Added [a] "task" (pending).');
    expect(store.read(false)).toHaveLength(1);
  });

  // Edge: the append tool lets a duplicate-id throw propagate (loop flags isError).
  test("edge: todo_append propagates a duplicate-id error", () => {
    const { append } = tools();
    append.execute({ id: "a", content: "x", status: "pending" } as never, ctx);
    expect(() =>
      append.execute({ id: "a", content: "y", status: "pending" } as never, ctx),
    ).toThrow(/already exists/);
  });

  // Edge: updating with neither content nor status is a no-op advisory, not an error.
  test("edge: todo_update with nothing to change returns an advisory", () => {
    const { append, update } = tools();
    append.execute({ id: "a", content: "x", status: "pending" } as never, ctx);
    expect(content(update.execute({ id: "a" } as never, ctx))).toMatch(/Nothing to update/);
  });

  // Edge: the retry-limit message appears once the limit is reached.
  test("edge: todo_update warns at the retry limit", () => {
    const { append, update } = tools();
    append.execute({ id: "a", content: "x", status: "pending" } as never, ctx);
    let last = "";
    for (let i = 0; i < RETRY_LIMIT; i += 1) {
      update.execute({ id: "a", status: "failed" } as never, ctx);
      last = content(update.execute({ id: "a", status: "in_progress" } as never, ctx));
    }
    expect(last).toMatch(/retry limit reached/);
    expect(last).toContain(`${RETRY_LIMIT} of ${RETRY_LIMIT}`);
  });

  // Edge: the schema rejects an out-of-enum status at the tool boundary.
  test("edge: todo_append rejects an invalid status via the schema", () => {
    const { append } = tools();
    const call: ToolCall = {
      id: "c1",
      type: ToolCallType.Function,
      function: { name: "todo_append", arguments: JSON.stringify({ id: "a", content: "x", status: "bad" }) },
    };
    expect(() => validateToolArguments(append, call)).toThrow(/status/);
  });

  // Edge: all three tools run sequentially — they share one mutable list.
  test("edge: all tools are sequential", () => {
    const { append, list, update } = tools();
    for (const tool of [append, list, update]) {
      expect(tool.executionMode).toBe(ExecutionMode.Sequential);
    }
  });

  // Integration: append then list across turns in runAgent.
  test("integration: append then list across turns", async () => {
    const store = new InMemoryTodoStore();
    const model = new MockModelClient([
      { toolCalls: [{ name: "todo_append", arguments: { id: "step-1", content: "Inspect repo", status: "pending" } }] },
      { toolCalls: [{ name: "todo_list", arguments: {} }] },
      { text: "done" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "track my work",
      tools: todoListTools(store),
    });

    const toolMessages = result.messages.filter(isToolMessage);
    expect(toolMessages[0]?.content).toContain('Added [step-1] "Inspect repo" (pending).');
    expect(toolMessages[1]?.content).toContain("[step-1] Inspect repo (pending)");
  });

  // Integration: a duplicate append surfaces as an isError tool result, run continues.
  test("integration: a duplicate append becomes an isError result", async () => {
    const store = new InMemoryTodoStore();
    const model = new MockModelClient([
      { toolCalls: [{ name: "todo_append", arguments: { id: "a", content: "first", status: "pending" } }] },
      { toolCalls: [{ name: "todo_append", arguments: { id: "a", content: "dup", status: "pending" } }] },
      { text: "recovered" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "oops duplicate",
      tools: todoListTools(store),
    });

    const toolMessages = result.messages.filter(isToolMessage);
    expect(toolMessages[0]?.isError ?? false).toBe(false);
    expect(toolMessages[1]?.isError).toBe(true);
    expect(toolMessages[1]?.content).toMatch(/already exists/);
    expect(result.messages.at(-1)?.content).toBe("recovered");
  });
});

describe("formatTodoList", () => {
  // Edge: an empty list still shows the header and zeroed counts.
  test("edge: empty list shows header and counts only", () => {
    const out = formatTodoList([]);
    expect(out).toContain("To-do list (0 items)");
    expect(out).toContain("0 pending");
    expect(out).not.toContain("-----");
  });

  // Edge: a retried item shows its retry count inline.
  test("edge: a retried item shows a retry note", () => {
    const out = formatTodoList([
      { id: "a", content: "task", status: "in_progress", retries: 2 },
    ]);
    expect(out).toContain("- [a] task (in_progress, 2 retries)");
  });
});
