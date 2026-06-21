import { describe, expect, test } from "bun:test";
import { codeExecutionTool, formatCodeExecutionResult } from "../tools/builtin/code-execution";
import { MockCodeExecutionBackend } from "../mocks/mock-code-execution";
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
  function: { name: "code_execution", arguments: JSON.stringify(args) },
});

describe("codeExecutionTool", () => {
  // Base case: the tool runs the code and returns its stdout, forwarding the
  // language and source to the backend untouched.
  test("base: runs the code and returns stdout", async () => {
    const backend = new MockCodeExecutionBackend({ stdout: "42\n", stderr: "", exitCode: 0 });
    const tool = codeExecutionTool(backend);
    const result = await tool.execute(
      { language: "javascript", code: "console.log(6 * 7)" } as never,
      ctx,
    );

    expect(result.content).toBe("42\n[exit 0: ok]");
    expect(backend.calls[0]?.request).toEqual({
      language: "javascript",
      code: "console.log(6 * 7)",
    });
  });

  // Edge: a non-zero exit and stderr are surfaced in content, not thrown.
  test("edge: non-zero exit and stderr surface in content (no throw)", async () => {
    const backend = new MockCodeExecutionBackend({ stdout: "", stderr: "boom\n", exitCode: 1 });
    const result = await codeExecutionTool(backend).execute(
      { language: "python", code: "raise SystemExit(1)" } as never,
      ctx,
    );

    expect(result.content).toContain("[stderr]");
    expect(result.content).toContain("boom");
    expect(result.content).toContain("[exit 1: error]");
  });

  // Edge: an empty run is never contentless — it still reports its verdict.
  test("edge: empty run still reports a verdict", async () => {
    const result = await codeExecutionTool(new MockCodeExecutionBackend()).execute(
      { language: "javascript", code: "" } as never,
      ctx,
    );
    expect(result.content).toBe("[exit 0: ok]");
  });

  // Edge: the loop's abort signal is forwarded to the backend.
  test("edge: forwards the abort signal to the backend", async () => {
    const backend = new MockCodeExecutionBackend();
    const controller = new AbortController();
    await codeExecutionTool(backend).execute(
      { language: "javascript", code: "1" } as never,
      { toolCallId: "c1", signal: controller.signal },
    );
    expect(backend.calls[0]?.ctx.signal).toBe(controller.signal);
  });

  // Edge: code execution runs sequentially — snippets must never race each other.
  test("edge: executionMode is sequential", () => {
    expect(codeExecutionTool(new MockCodeExecutionBackend()).executionMode).toBe(
      ExecutionMode.Sequential,
    );
  });

  // Edge: the schema requires the code string.
  test("edge: missing code fails validation", () => {
    expect(() =>
      validateToolArguments(
        codeExecutionTool(new MockCodeExecutionBackend()),
        call({ language: "javascript" }),
      ),
    ).toThrow(/code/);
  });

  // Edge: the model-facing spec advertises the stable name + schema.
  test("edge: toToolSpec advertises name and params", () => {
    const spec = toToolSpec(codeExecutionTool(new MockCodeExecutionBackend()));
    expect(spec.name).toBe("code_execution");
    expect(Object.keys((spec.parameters as any).properties)).toEqual(["language", "code"]);
  });

  // Integration: the tool folds into runAgent (call -> result -> final answer).
  test("integration: drives a runAgent tool turn", async () => {
    const backend = new MockCodeExecutionBackend({ stdout: "42\n", stderr: "", exitCode: 0 });
    const model = new MockModelClient([
      {
        toolCalls: [
          { name: "code_execution", arguments: { language: "javascript", code: "console.log(6*7)" } },
        ],
      },
      { text: "the answer is 42" },
    ]);
    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "s",
      prompt: "what is 6 times 7",
      tools: [codeExecutionTool(backend)],
    });

    expect(result.messages.find((m) => m.role === Role.Tool)?.content).toBe("42\n[exit 0: ok]");
    expect(result.messages.at(-1)?.content).toBe("the answer is 42");
    expect(backend.calls[0]?.request.code).toBe("console.log(6*7)");
  });
});

describe("formatCodeExecutionResult", () => {
  // Edge: stdout and stderr are both shown, trailing newlines stripped, and the
  // success verdict is always appended.
  test("edge: combines stdout and stderr with an exit verdict", () => {
    expect(formatCodeExecutionResult({ stdout: "out\n", stderr: "err\n", exitCode: 0 })).toBe(
      "out\n[stderr]\nerr\n[exit 0: ok]",
    );
  });

  // Edge: a failing run states the non-zero exit code as an error.
  test("edge: a failing run states the exit code as an error", () => {
    expect(formatCodeExecutionResult({ stdout: "", stderr: "", exitCode: 2 })).toBe(
      "[exit 2: error]",
    );
  });
});
