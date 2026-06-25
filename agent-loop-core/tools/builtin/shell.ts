/**
 * The `shell` tool: SDK-owned wiring over the {@link ShellBackend} seam.
 *
 * @remarks
 * The consumer supplies the backend (the dangerous part — see
 * {@link ShellBackend | builtin.types.ts}); this fixes the model-facing contract
 * (name, schema, result shaping) so the model always sees a stable `shell`
 * regardless of how it is executed.
 *
 * @module
 */

import { z } from "zod";
import { defineTool } from "../tools";
import type { Tool } from "../tools.types";
import { ExecutionMode } from "../tools.types";
import type { ShellBackend, ShellResult } from "./builtin.types";

/**
 * Build a `shell` tool bound to a backend.
 *
 * @remarks
 * Runs sequentially ({@link ExecutionMode.Sequential}): shell commands commonly
 * have side effects and order matters, so the loop must not race a batch of them
 * against each other. Results are shaped by {@link formatShellResult}.
 *
 * @param backend - The {@link ShellBackend} that actually executes commands on the host.
 * @returns A {@link Tool} named `shell` ready to pass to the agent loop or a {@link ToolRegistry}.
 * @see {@link ShellBackend}
 * @see {@link ToolRegistry}
 * @example
 * ```ts
 * const tool = shellTool(myShellBackend);
 * // Recommended: gate a shell tool before granting it to an untrusted model.
 * await runAgent({ ...opts, tools: [tool] });
 * // The model can now call: shell({ command: "ls -la" })
 * ```
 * @group Built-in Tools
 */
export function shellTool(backend: ShellBackend): Tool {
  return defineTool({
    name: "shell",
    description:
      "Run a shell command and return its stdout, stderr, and exit code.",
    parameters: z.object({
      command: z.string().describe("The shell command to execute."),
    }),
    executionMode: ExecutionMode.Sequential,
    execute: async ({ command }, ctx) => ({
      content: formatShellResult(await backend.exec(command, ctx)),
    }),
  });
}

/**
 * Fold a {@link ShellResult} into the single text result the loop hands to the model.
 *
 * @remarks
 * A non-zero exit is NOT a tool error (the command ran) — it is surfaced in the
 * content so the model can react, with stderr and the exit code shown only when
 * they carry signal. Empty output yields `"(no output)"`.
 *
 * @param result - The stdout/stderr/exit code captured by a {@link ShellBackend}.
 * @returns A text block combining stdout, an annotated stderr section, and the exit code when non-zero.
 * @see {@link shellTool}
 * @group Built-in Tools
 */
export function formatShellResult(result: ShellResult): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(stripTrailingNewline(result.stdout));
  if (result.stderr) parts.push(`[stderr]\n${stripTrailingNewline(result.stderr)}`);
  if (result.exitCode !== 0) parts.push(`[exit code: ${result.exitCode}]`);
  return parts.length > 0 ? parts.join("\n") : "(no output)";
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
