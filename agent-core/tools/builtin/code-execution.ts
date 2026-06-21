/**
 * The `code_execution` tool: SDK-owned wiring over the {@link CodeExecutionBackend} seam.
 *
 * @remarks
 * The consumer supplies the backend (the dangerous part — see
 * {@link CodeExecutionBackend | builtin.types.ts}); this fixes the model-facing
 * contract (name, schema, result shaping) so the model always sees a stable
 * `code_execution` regardless of where the code actually runs.
 *
 * @module
 */

import { z } from "zod";
import { defineTool } from "../tools";
import type { Tool } from "../tools.types";
import { ExecutionMode } from "../tools.types";
import type { CodeExecutionBackend, CodeExecutionResult } from "./builtin.types";

/**
 * Build a `code_execution` tool bound to a backend.
 *
 * @remarks
 * Runs sequentially ({@link ExecutionMode.Sequential}): model-written code
 * commonly has side effects and often shares a workspace, so the loop must not
 * race a batch of snippets against each other — the same reasoning as
 * {@link shellTool}. The `language` is an open string: the contract stays stable
 * across backends, and each backend rejects what it cannot run. Results are
 * shaped by {@link formatCodeExecutionResult}.
 *
 * @param backend - The {@link CodeExecutionBackend} that actually runs code in a sandbox.
 * @returns A {@link Tool} named `code_execution` ready to pass to the agent loop or a {@link ToolRegistry}.
 * @see {@link CodeExecutionBackend}
 * @see {@link shellTool} — its single-command sibling.
 * @example
 * ```ts
 * const tool = codeExecutionTool(denoCodeExecutionBackend());
 * // Recommended: gate code execution before granting it to an untrusted model.
 * await runAgent({ ...opts, tools: [tool] });
 * // The model can now call: code_execution({ language: "javascript", code: "console.log(6 * 7)" })
 * ```
 * @group Built-in Tools
 */
export function codeExecutionTool(backend: CodeExecutionBackend): Tool {
  return defineTool({
    name: "code_execution",
    description:
      "Run a snippet of code in a sandbox and return its stdout, stderr, and exit code.",
    parameters: z.object({
      language: z
        .string()
        .describe('Runtime to run the code in, e.g. "python", "javascript", "typescript".'),
      code: z.string().describe("The source code to execute."),
    }),
    executionMode: ExecutionMode.Sequential,
    execute: async ({ language, code }, ctx) => ({
      content: formatCodeExecutionResult(await backend.exec({ language, code }, ctx)),
    }),
  });
}

/**
 * Fold a {@link CodeExecutionResult} into the single text result the loop hands to the model.
 *
 * @remarks
 * Every result ends with an explicit verdict — `[exit 0: ok]` on success or
 * `[exit N: error]` on failure — so a code run is *never* a contentless result:
 * "ran but printed nothing" reads as a clear success rather than an ambiguous
 * empty string. A non-zero exit is NOT a tool error (the code ran); it is
 * surfaced so the model can react. This deliberately diverges from
 * {@link formatShellResult}, which hides a zero exit and falls back to
 * `"(no output)"` — code execution always states its outcome.
 *
 * @param result - The stdout/stderr/exit code captured by a {@link CodeExecutionBackend}.
 * @returns A text block: stdout, an annotated stderr section when present, and an always-present exit verdict.
 * @see {@link codeExecutionTool}
 * @group Built-in Tools
 */
export function formatCodeExecutionResult(result: CodeExecutionResult): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(stripTrailingNewline(result.stdout));
  if (result.stderr) parts.push(`[stderr]\n${stripTrailingNewline(result.stderr)}`);
  // Always end with the verdict so a code run is never a contentless result —
  // "ran but printed nothing" reads as a clear success, not an empty string.
  parts.push(result.exitCode === 0 ? "[exit 0: ok]" : `[exit ${result.exitCode}: error]`);
  return parts.join("\n");
}

/**
 * Strip a single trailing newline so joined sections don't gain blank lines.
 *
 * @param text - The text to trim.
 * @returns The text without one trailing `\n`.
 * @internal
 */
function stripTrailingNewline(text: string): string {
  return text.replace(/\n$/, "");
}
