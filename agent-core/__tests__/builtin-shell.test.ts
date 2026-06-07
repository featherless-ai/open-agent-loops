import { describe, expect, test } from "bun:test";
import { shellTool, formatShellResult } from "../tools/builtin/shell";
import { MockShellBackend } from "../mocks/mock-shell";
import { toToolSpec, validateToolArguments } from "../tools/tools";
import { runAgent } from "../primitives/loop";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import type { ToolCall } from "../types";
import { Role, ToolCallType } from "../types";
import { ExecutionMode } from "../tools/tools.types";

const ctx = { toolCallId: "c1" };

const call = (args: Record<string, unknown>): ToolCall => ({
  id: "c1",
  type: ToolCallType.Function,
  function: { name: "shell", arguments: JSON.stringify(args) },
});

describe("shellTool", () => {
  // Base case: the tool runs the command and returns its stdout.
  test("base: runs the command and returns stdout", async () => {
    const backend = new MockShellBackend({ stdout: "hello\n", stderr: "", exitCode: 0 });
    const tool = shellTool(backend);
    const result = await tool.execute({ command: "echo hello" } as never, ctx);

    expect(result.content).toBe("hello");
    expect(backend.calls.map((c) => c.command)).toEqual(["echo hello"]);
  });

  // Edge: a non-zero exit and stderr are surfaced in content, not thrown.
  test("edge: non-zero exit and stderr surface in content (no throw)", async () => {
    const backend = new MockShellBackend({ stdout: "", stderr: "boom\n", exitCode: 2 });
    const result = await shellTool(backend).execute({ command: "false" } as never, ctx);

    expect(result.content).toContain("[stderr]");
    expect(result.content).toContain("boom");
    expect(result.content).toContain("[exit code: 2]");
  });

  // Edge: a clean command with no output gives a clear placeholder.
  test("edge: no output yields a placeholder", async () => {
    const result = await shellTool(new MockShellBackend()).execute(
      { command: "true" } as never,
      ctx,
    );
    expect(result.content).toBe("(no output)");
  });

  // Edge: the loop's abort signal is forwarded to the backend.
  test("edge: forwards the abort signal to the backend", async () => {
    const backend = new MockShellBackend();
    const controller = new AbortController();
    await shellTool(backend).execute(
      { command: "sleep 1" } as never,
      { toolCallId: "c1", signal: controller.signal },
    );
    expect(backend.calls[0]?.ctx.signal).toBe(controller.signal);
  });

  // Edge: shell runs sequentially — its commands must never race each other.
  test("edge: executionMode is sequential", () => {
    expect(shellTool(new MockShellBackend()).executionMode).toBe(ExecutionMode.Sequential);
  });

  // Edge: the schema requires a command string.
  test("edge: missing command fails validation", () => {
    expect(() => validateToolArguments(shellTool(new MockShellBackend()), call({}))).toThrow(
      /command/,
    );
  });

  // Edge: the model-facing spec advertises the stable name + schema.
  test("edge: toToolSpec advertises name and command param", () => {
    const spec = toToolSpec(shellTool(new MockShellBackend()));
    expect(spec.name).toBe("shell");
    expect(Object.keys((spec.parameters as any).properties)).toEqual(["command"]);
  });

  // Integration: the tool folds into runAgent (call -> result -> final answer).
  test("integration: drives a runAgent tool turn", async () => {
    const backend = new MockShellBackend({ stdout: "files\n", stderr: "", exitCode: 0 });
    const model = new MockModelClient([
      { toolCalls: [{ name: "shell", arguments: { command: "ls" } }] },
      { text: "done" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "list files",
      tools: [shellTool(backend)],
    });

    expect(result.messages.find((m) => m.role === Role.Tool)?.content).toBe("files");
    expect(result.messages.at(-1)?.content).toBe("done");
    expect(backend.calls[0]?.command).toBe("ls");
  });
});

describe("formatShellResult", () => {
  // Edge: stdout and stderr are both shown, trailing newlines stripped.
  test("edge: combines stdout and stderr without trailing newlines", () => {
    expect(formatShellResult({ stdout: "out\n", stderr: "err\n", exitCode: 0 })).toBe(
      "out\n[stderr]\nerr",
    );
  });
});
