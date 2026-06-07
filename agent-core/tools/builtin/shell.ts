/**
 * The `shell` tool: SDK-owned wiring over the {@link ShellBackend} seam. The
 * consumer supplies the backend (the dangerous part — see `builtin.types.ts`);
 * this fixes the model-facing contract (name, schema, result shaping) so the
 * model always sees a stable `shell` regardless of how it is executed.
 */

import { z } from "zod";
import { defineTool } from "../tools";
import type { Tool } from "../tools.types";
import { ExecutionMode } from "../tools.types";
import type { ShellBackend, ShellResult } from "./builtin.types";

/**
 * Build a `shell` tool bound to `backend`. Runs sequentially: shell commands
 * commonly have side effects and order matters, so the loop must not race a
 * batch of them against each other.
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
 * Fold a {@link ShellResult} into the single text result the loop hands to the
 * model. A non-zero exit is NOT a tool error (the command ran) — it is surfaced
 * in the content so the model can react, with stderr and the exit code shown
 * only when they carry signal.
 */
export function formatShellResult(result: ShellResult): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(stripTrailingNewline(result.stdout));
  if (result.stderr) parts.push(`[stderr]\n${stripTrailingNewline(result.stderr)}`);
  if (result.exitCode !== 0) parts.push(`[exit code: ${result.exitCode}]`);
  return parts.length > 0 ? parts.join("\n") : "(no output)";
}

function stripTrailingNewline(text: string): string {
  return text.replace(/\n$/, "");
}
