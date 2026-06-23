/**
 * The `write` and `edit` tools: SDK-owned wiring over the {@link FileWriteBackend} seam.
 *
 * @remarks
 * The consumer supplies the backend (the dangerous, host-mutating part — see
 * {@link FileWriteBackend | builtin.types.ts}); this fixes the model-facing
 * contract (names, schemas, result shaping) so the model always sees stable
 * `write` and `edit` tools regardless of how files are actually changed. Like
 * `shell`, both mutate the host and so run sequentially.
 *
 * @module
 */

import { z } from "zod";
import { defineTool } from "../tools";
import type { Tool } from "../tools.types";
import { ExecutionMode } from "../tools.types";
import type { FileEditResult, FileWriteBackend, FileWriteResult } from "./builtin.types";

/**
 * Build a `write` tool bound to a backend.
 *
 * @remarks
 * Runs sequentially ({@link ExecutionMode.Sequential}) for the same reason
 * `shell` does: writes have side effects and order matters, so the loop must not
 * race a batch of them. Results are shaped by {@link formatWriteResult}.
 *
 * @param backend - The {@link FileWriteBackend} that actually writes to the host.
 * @returns A {@link Tool} named `write` ready to pass to the agent loop or a {@link ToolRegistry}.
 * @see {@link FileWriteBackend}
 * @see {@link ToolRegistry}
 * @example
 * ```ts
 * const tool = writeTool(myFileWriteBackend);
 * // Recommended: gate a write tool before granting it to an untrusted model.
 * await runAgent({ ...opts, tools: [tool] });
 * // The model can now call: write({ path: "out.txt", content: "hello" })
 * ```
 * @group Built-in Tools
 */
export function writeTool(backend: FileWriteBackend): Tool {
  return defineTool({
    name: "write",
    description:
      "Write content to a file, creating it (and any missing parent directories) if needed. Overwrites existing content.",
    parameters: z.object({
      path: z.string().describe("Path of the file to write."),
      content: z.string().describe("Full content to write to the file."),
    }),
    executionMode: ExecutionMode.Sequential,
    execute: async (request, ctx) => ({
      content: formatWriteResult(await backend.write(request, ctx)),
    }),
  });
}

/**
 * Build an `edit` tool bound to a backend.
 *
 * @remarks
 * Runs sequentially ({@link ExecutionMode.Sequential}): like `write`, edits
 * mutate the host and ordering matters. Results are shaped by
 * {@link formatEditResult}, which surfaces a missing target string in the content
 * (model-recoverable) rather than as a thrown error.
 *
 * @param backend - The {@link FileWriteBackend} that actually edits the host.
 * @returns A {@link Tool} named `edit` ready to pass to the agent loop or a {@link ToolRegistry}.
 * @see {@link FileWriteBackend}
 * @see {@link ToolRegistry}
 * @example
 * ```ts
 * const tool = editTool(myFileWriteBackend);
 * await runAgent({ ...opts, tools: [tool] });
 * // The model can now call: edit({ path: "app.ts", oldString: "v1", newString: "v2" })
 * ```
 * @group Built-in Tools
 */
export function editTool(backend: FileWriteBackend): Tool {
  return defineTool({
    name: "edit",
    description: "Replace the first occurrence of a string in a file with a new string.",
    parameters: z.object({
      path: z.string().describe("Path of the file to edit."),
      oldString: z.string().describe("Exact string to find and replace."),
      newString: z.string().describe("String to replace the first occurrence with."),
    }),
    executionMode: ExecutionMode.Sequential,
    execute: async (request, ctx) => ({
      content: formatEditResult(await backend.edit(request, ctx)),
    }),
  });
}

/**
 * Render a write outcome into the single text block handed to the model.
 *
 * @param result - The path and byte count captured by a {@link FileWriteBackend}.
 * @returns A confirmation line, e.g. `"Wrote 12 bytes to out.txt"`.
 * @see {@link writeTool}
 * @group Built-in Tools
 */
export function formatWriteResult(result: FileWriteResult): string {
  return `Wrote ${result.bytesWritten} bytes to ${result.path}`;
}

/**
 * Render an edit outcome into the single text block handed to the model.
 *
 * @remarks
 * A missing target string is NOT a tool error (the file was read fine) — it is
 * surfaced in the content so the model can retry with a different string, the
 * same way a non-zero shell exit is surfaced rather than thrown.
 *
 * @param result - The path and replacement flag captured by a {@link FileWriteBackend}.
 * @returns `"Edited {path}"` on success, or a clear note when the target string was absent.
 * @see {@link editTool}
 * @group Built-in Tools
 */
export function formatEditResult(result: FileEditResult): string {
  return result.replaced
    ? `Edited ${result.path}`
    : `No occurrence of the target string was found in ${result.path}; nothing changed.`;
}
