import { describe, expect, test } from "bun:test";
import { writeTool, editTool, formatWriteResult, formatEditResult } from "../tools/builtin/file-write";
import { MockFileWriteBackend } from "../mocks/mock-file-write";
import { toToolSpec, validateToolArguments } from "../tools/tools";
import { runAgent } from "../primitives/loop";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import type { ToolCall } from "../types";
import { Role, ToolCallType } from "../types";
import { ExecutionMode } from "../tools/tools.types";

const ctx = { toolCallId: "c1" };

const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: "c1",
  type: ToolCallType.Function,
  function: { name, arguments: JSON.stringify(args) },
});

describe("writeTool", () => {
  // Base case: the tool reports bytes written and forwards the request.
  test("base: reports bytes written", async () => {
    const backend = new MockFileWriteBackend();
    const result = await writeTool(backend).execute(
      { path: "a.txt", content: "hello" } as never,
      ctx,
    );

    expect(result.content).toBe("Wrote 5 bytes to a.txt");
    expect(backend.writes[0]?.request).toEqual({ path: "a.txt", content: "hello" });
  });

  // Edge: writes mutate the host, so they run sequentially (never race).
  test("edge: executionMode is sequential", () => {
    expect(writeTool(new MockFileWriteBackend()).executionMode).toBe(ExecutionMode.Sequential);
  });

  // Edge: the schema requires both path and content.
  test("edge: missing content fails validation", () => {
    expect(() =>
      validateToolArguments(writeTool(new MockFileWriteBackend()), call("write", { path: "a.txt" })),
    ).toThrow(/content/);
  });

  // Edge: the loop's abort signal is forwarded to the backend.
  test("edge: forwards the abort signal to the backend", async () => {
    const backend = new MockFileWriteBackend();
    const controller = new AbortController();
    await writeTool(backend).execute(
      { path: "a.txt", content: "x" } as never,
      { toolCallId: "c1", signal: controller.signal },
    );
    expect(backend.writes[0]?.ctx.signal).toBe(controller.signal);
  });
});

describe("editTool", () => {
  // Base case: a successful replacement reports the edited path.
  test("base: reports the edited path", async () => {
    const backend = new MockFileWriteBackend();
    const result = await editTool(backend).execute(
      { path: "a.txt", oldString: "x", newString: "y" } as never,
      ctx,
    );

    expect(result.content).toBe("Edited a.txt");
    expect(backend.edits[0]?.request).toEqual({ path: "a.txt", oldString: "x", newString: "y" });
  });

  // Edge: a missing target string is surfaced in content, not thrown.
  test("edge: missing target surfaces in content (no throw)", async () => {
    const backend = new MockFileWriteBackend(undefined, { path: "a.txt", replaced: false });
    const result = await editTool(backend).execute(
      { path: "a.txt", oldString: "nope", newString: "y" } as never,
      ctx,
    );

    expect(result.content).toContain("No occurrence");
    expect(result.content).toContain("a.txt");
  });

  // Edge: edits mutate the host, so they run sequentially.
  test("edge: executionMode is sequential", () => {
    expect(editTool(new MockFileWriteBackend()).executionMode).toBe(ExecutionMode.Sequential);
  });

  // Edge: the schema requires the oldString to find.
  test("edge: missing oldString fails validation", () => {
    expect(() =>
      validateToolArguments(
        editTool(new MockFileWriteBackend()),
        call("edit", { path: "a.txt", newString: "y" }),
      ),
    ).toThrow(/oldString/);
  });

  // Integration: the tool folds into runAgent (edit -> result -> answer).
  test("integration: drives a runAgent tool turn", async () => {
    const backend = new MockFileWriteBackend();
    const model = new MockModelClient([
      { toolCalls: [{ name: "edit", arguments: { path: "a.txt", oldString: "a", newString: "b" } }] },
      { text: "patched" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "patch the file",
      tools: [editTool(backend)],
    });

    expect(result.messages.find((m) => m.role === Role.Tool)?.content).toBe("Edited a.txt");
    expect(result.messages.at(-1)?.content).toBe("patched");
    expect(backend.edits[0]?.request.oldString).toBe("a");
  });
});

describe("formatWriteResult", () => {
  // Base case: renders the byte count and path.
  test("base: renders bytes and path", () => {
    expect(formatWriteResult({ path: "f.txt", bytesWritten: 12 })).toBe("Wrote 12 bytes to f.txt");
  });
});

describe("formatEditResult", () => {
  // Edge: a not-found edit renders a clear, model-recoverable note.
  test("edge: not replaced renders a clear note", () => {
    expect(formatEditResult({ path: "f.txt", replaced: false })).toContain("No occurrence");
  });
});
