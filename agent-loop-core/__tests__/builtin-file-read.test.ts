import { describe, expect, test } from "bun:test";
import { readTool, globTool, formatFileContent, formatGlobMatches } from "../tools/builtin/file-read";
import { MockFileReadBackend } from "../mocks/mock-file-read";
import { toToolSpec, validateToolArguments } from "../tools/tools";
import { runAgent } from "../primitives/loop";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import type { ToolCall } from "../types";
import { Role, ToolCallType } from "../types";

const ctx = { toolCallId: "c1" };

const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: "c1",
  type: ToolCallType.Function,
  function: { name, arguments: JSON.stringify(args) },
});

describe("readTool", () => {
  // Base case: lines render with 1-based numbers counting up from startLine.
  test("base: numbers lines from startLine", async () => {
    const backend = new MockFileReadBackend({ lines: ["first", "second"], startLine: 5 });
    const result = await readTool(backend).execute({ path: "a.txt" } as never, ctx);

    expect(result.content).toBe("5: first\n6: second");
  });

  // Edge: an empty file gives a clear placeholder rather than "".
  test("edge: empty file yields a placeholder", async () => {
    const result = await readTool(new MockFileReadBackend()).execute(
      { path: "a.txt" } as never,
      ctx,
    );
    expect(result.content).toBe("(no content)");
  });

  // Edge: path, offset, and limit are forwarded to the backend verbatim.
  test("edge: forwards path, offset, limit", async () => {
    const backend = new MockFileReadBackend();
    await readTool(backend).execute({ path: "a.txt", offset: 10, limit: 20 } as never, ctx);
    expect(backend.reads[0]?.request).toEqual({ path: "a.txt", offset: 10, limit: 20 });
  });

  // Edge: the loop's abort signal is forwarded to the backend.
  test("edge: forwards the abort signal to the backend", async () => {
    const backend = new MockFileReadBackend();
    const controller = new AbortController();
    await readTool(backend).execute(
      { path: "a.txt" } as never,
      { toolCallId: "c1", signal: controller.signal },
    );
    expect(backend.reads[0]?.ctx.signal).toBe(controller.signal);
  });

  // Edge: the schema requires a path string.
  test("edge: missing path fails validation", () => {
    expect(() =>
      validateToolArguments(readTool(new MockFileReadBackend()), call("read", {})),
    ).toThrow(/path/);
  });

  // Edge: the model-facing spec advertises the stable name + path param.
  test("edge: toToolSpec advertises name and path param", () => {
    const spec = toToolSpec(readTool(new MockFileReadBackend()));
    expect(spec.name).toBe("read");
    expect((spec.parameters as any).properties.path.type).toBe("string");
  });
});

describe("globTool", () => {
  // Base case: matches render one path per line.
  test("base: one path per line", async () => {
    const backend = new MockFileReadBackend(undefined, ["src/a.ts", "src/b.ts"]);
    const result = await globTool(backend).execute({ pattern: "**/*.ts" } as never, ctx);

    expect(result.content).toBe("src/a.ts\nsrc/b.ts");
  });

  // Edge: no matches gives a clear note rather than an empty string.
  test("edge: no matches yields a clear note", async () => {
    const result = await globTool(new MockFileReadBackend()).execute(
      { pattern: "*.none" } as never,
      ctx,
    );
    expect(result.content).toBe("No files matched.");
  });

  // Edge: pattern and path are forwarded to the backend verbatim.
  test("edge: forwards pattern and path", async () => {
    const backend = new MockFileReadBackend();
    await globTool(backend).execute({ pattern: "*.ts", path: "src" } as never, ctx);
    expect(backend.globs[0]?.query).toEqual({ pattern: "*.ts", path: "src" });
  });

  // Integration: the tool folds into runAgent (glob -> result -> answer).
  test("integration: drives a runAgent tool turn", async () => {
    const backend = new MockFileReadBackend(undefined, ["found.ts"]);
    const model = new MockModelClient([
      { toolCalls: [{ name: "glob", arguments: { pattern: "*.ts" } }] },
      { text: "listed" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "find ts files",
      tools: [globTool(backend)],
    });

    expect(result.messages.find((m) => m.role === Role.Tool)?.content).toBe("found.ts");
    expect(result.messages.at(-1)?.content).toBe("listed");
    expect(backend.globs[0]?.query.pattern).toBe("*.ts");
  });
});

describe("formatFileContent", () => {
  // Edge: an empty slice is the "(no content)" sentinel.
  test("edge: empty slice renders the placeholder", () => {
    expect(formatFileContent({ lines: [], startLine: 1 })).toBe("(no content)");
  });
});

describe("formatGlobMatches", () => {
  // Edge: an empty list is the "no files" sentinel.
  test("edge: empty list renders the no-files note", () => {
    expect(formatGlobMatches([])).toBe("No files matched.");
  });
});
