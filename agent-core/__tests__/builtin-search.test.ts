import { describe, expect, test } from "bun:test";
import { searchTool, formatSearchResults } from "../tools/builtin/search";
import { MockSearchBackend } from "../mocks/mock-search";
import { toToolSpec, validateToolArguments } from "../tools/tools";
import { runAgent } from "../primitives/loop";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import type { ToolCall } from "../types";
import { Role, ToolCallType } from "../types";

const ctx = { toolCallId: "c1" };

const call = (args: Record<string, unknown>): ToolCall => ({
  id: "c1",
  type: ToolCallType.Function,
  function: { name: "search", arguments: JSON.stringify(args) },
});

describe("searchTool", () => {
  // Base case: matches render as path:line: text, one per line.
  test("base: renders matches as path:line: text", async () => {
    const backend = new MockSearchBackend([
      { path: "a.ts", line: 3, text: "const x = 1" },
      { path: "b.ts", line: 9, text: "const x = 2" },
    ]);
    const result = await searchTool(backend).execute({ pattern: "const x" } as never, ctx);

    expect(result.content).toBe("a.ts:3: const x = 1\nb.ts:9: const x = 2");
  });

  // Edge: no matches gives a clear note rather than an empty string.
  test("edge: no matches yields a clear note", async () => {
    const result = await searchTool(new MockSearchBackend()).execute(
      { pattern: "nope" } as never,
      ctx,
    );
    expect(result.content).toBe("No matches found.");
  });

  // Edge: every optional field is forwarded to the backend verbatim.
  test("edge: forwards pattern, path, ignoreCase, maxResults", async () => {
    const backend = new MockSearchBackend();
    await searchTool(backend).execute(
      { pattern: "foo", path: "src", ignoreCase: true, maxResults: 5 } as never,
      ctx,
    );
    expect(backend.queries[0]).toEqual({
      pattern: "foo",
      path: "src",
      ignoreCase: true,
      maxResults: 5,
    });
  });

  // Edge: the schema requires a pattern string.
  test("edge: missing pattern fails validation", () => {
    expect(() => validateToolArguments(searchTool(new MockSearchBackend()), call({}))).toThrow(
      /pattern/,
    );
  });

  // Edge: the model-facing spec advertises the stable name + pattern param.
  test("edge: toToolSpec advertises name and pattern param", () => {
    const spec = toToolSpec(searchTool(new MockSearchBackend()));
    expect(spec.name).toBe("search");
    expect((spec.parameters as any).properties.pattern.type).toBe("string");
  });

  // Integration: the tool folds into runAgent (search -> result -> answer).
  test("integration: drives a runAgent tool turn", async () => {
    const backend = new MockSearchBackend([{ path: "x.ts", line: 1, text: "hit" }]);
    const model = new MockModelClient([
      { toolCalls: [{ name: "search", arguments: { pattern: "hit" } }] },
      { text: "found it" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "find hit",
      tools: [searchTool(backend)],
    });

    expect(result.messages.find((m) => m.role === Role.Tool)?.content).toBe("x.ts:1: hit");
    expect(result.messages.at(-1)?.content).toBe("found it");
    expect(backend.queries[0]?.pattern).toBe("hit");
  });
});

describe("formatSearchResults", () => {
  // Edge: an empty list is the "no matches" sentinel.
  test("edge: empty list renders the no-matches note", () => {
    expect(formatSearchResults([])).toBe("No matches found.");
  });
});
