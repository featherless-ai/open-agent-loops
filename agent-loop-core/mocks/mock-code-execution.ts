/**
 * A scriptable `CodeExecutionBackend` for tests — the code-execution counterpart
 * to {@link MockShellBackend}.
 *
 * @remarks
 * This is a testing utility. It records every request (and the context it ran
 * with, so tests can assert the loop forwarded the abort signal) and returns a
 * fixed result, or one chosen per request by a function.
 *
 * @module
 */

import type { ToolContext } from "../tools/tools.types";
import type {
  CodeExecutionBackend,
  CodeExecutionRequest,
  CodeExecutionResult,
} from "../tools/builtin/builtin.types";

/**
 * The responder driving a {@link MockCodeExecutionBackend}: either a fixed result
 * or a function that decides per request.
 *
 * @group Testing
 */
export type CodeExecutionResponder =
  | CodeExecutionResult
  | ((request: CodeExecutionRequest) => CodeExecutionResult);

/** Default success result returned when no responder is supplied. */
const OK: CodeExecutionResult = { stdout: "", stderr: "", exitCode: 0 };

/**
 * Scriptable {@link CodeExecutionBackend} that records requests and replays results.
 *
 * @remarks
 * This is a testing utility. Every `(request, ctx)` pair is captured in
 * {@link calls} for assertions — including `ctx.signal`, so tests can verify the
 * loop forwarded the abort signal. Results come from the
 * {@link CodeExecutionResponder} supplied at construction.
 *
 * @example
 * ```ts
 * const backend = new MockCodeExecutionBackend({ stdout: "42", stderr: "", exitCode: 0 });
 * const result = await backend.exec({ language: "javascript", code: "console.log(42)" }, ctx);
 * expect(result.stdout).toBe("42");
 * expect(backend.calls[0].request.language).toBe("javascript");
 * ```
 *
 * @see {@link MockShellBackend}
 * @group Testing
 */
export class MockCodeExecutionBackend implements CodeExecutionBackend {
  /** Every (request, ctx) the tool ran, in order — handy for assertions. */
  readonly calls: Array<{ request: CodeExecutionRequest; ctx: ToolContext }> = [];

  /**
   * @param responder - A fixed result or a per-request function. Defaults to a
   * success result (`{ stdout: "", stderr: "", exitCode: 0 }`).
   */
  constructor(private readonly responder: CodeExecutionResponder = OK) {}

  /**
   * Record the request and context, then return the scripted result.
   * @param request - The language and source issued by the tool.
   * @param ctx - Per-call context; captured for assertions.
   * @returns The result from the responder.
   */
  async exec(request: CodeExecutionRequest, ctx: ToolContext): Promise<CodeExecutionResult> {
    this.calls.push({ request, ctx });
    return typeof this.responder === "function" ? this.responder(request) : this.responder;
  }
}
