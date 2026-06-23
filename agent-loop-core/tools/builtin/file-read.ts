/**
 * The `read` and `glob` tools: SDK-owned wiring over the {@link FileReadBackend} seam.
 *
 * @remarks
 * The consumer supplies the backend (the filesystem part — see
 * {@link FileReadBackend | builtin.types.ts}); this fixes the model-facing
 * contract (names, schemas, result shaping) so the model always sees stable
 * `read` and `glob` tools regardless of how files are accessed. Both are
 * read-only, the filesystem counterpart to `search`'s wiring in `./search`.
 *
 * @module
 */

import { z } from "zod";
import { defineTool } from "../tools";
import type { Tool } from "../tools.types";
import type { FileReadBackend, FileReadResult } from "./builtin.types";

/**
 * Build a `read` tool bound to a backend.
 *
 * @remarks
 * Read-only, so it keeps the default parallel execution mode. The result is
 * shaped by {@link formatFileContent}, which prefixes each line with its 1-based
 * number — the same `path:line:`-style addressing `search` uses, so the model
 * can quote line numbers back into an `edit`.
 *
 * @param backend - The {@link FileReadBackend} that performs the actual read.
 * @returns A {@link Tool} named `read` ready to pass to the agent loop or a {@link ToolRegistry}.
 * @see {@link FileReadBackend}
 * @see {@link ToolRegistry}
 * @example
 * ```ts
 * const tool = readTool(myFileReadBackend);
 * await runAgent({ ...opts, tools: [tool] });
 * // The model can now call: read({ path: "src/app.ts", offset: 40, limit: 20 })
 * ```
 * @group Built-in Tools
 */
export function readTool(backend: FileReadBackend): Tool {
  return defineTool({
    name: "read",
    description:
      "Read a slice of a text file. Returns the selected lines, each prefixed with its 1-based line number.",
    parameters: z.object({
      path: z.string().describe("Path of the file to read."),
      offset: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("1-based line to start reading at. Defaults to the start of the file."),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of lines to return."),
    }),
    execute: async (request, ctx) => ({
      content: formatFileContent(await backend.read(request, ctx)),
    }),
  });
}

/**
 * Build a `glob` tool bound to a backend.
 *
 * @remarks
 * Read-only, so it keeps the default parallel execution mode. Results are shaped
 * by {@link formatGlobMatches}.
 *
 * @param backend - The {@link FileReadBackend} that performs the actual glob.
 * @returns A {@link Tool} named `glob` ready to pass to the agent loop or a {@link ToolRegistry}.
 * @see {@link FileReadBackend}
 * @see {@link ToolRegistry}
 * @example
 * ```ts
 * const tool = globTool(myFileReadBackend);
 * await runAgent({ ...opts, tools: [tool] });
 * // The model can now call: glob({ pattern: "**\/*.ts", path: "src" })
 * ```
 * @group Built-in Tools
 */
export function globTool(backend: FileReadBackend): Tool {
  return defineTool({
    name: "glob",
    description:
      "Find files matching a glob pattern (e.g. '**/*.ts'). Returns one matching path per line.",
    parameters: z.object({
      pattern: z.string().describe("Glob pattern matched against file paths."),
      path: z
        .string()
        .optional()
        .describe("Directory to search under. Defaults to the backend's root."),
    }),
    execute: async (query, ctx) => ({
      content: formatGlobMatches(await backend.glob(query, ctx)),
    }),
  });
}

/**
 * Render a file slice into the single text block handed to the model.
 *
 * @remarks
 * Each line is prefixed with its 1-based number, counting up from
 * `result.startLine`. An empty slice yields a clear placeholder instead of an
 * empty string.
 *
 * @param result - The lines and start line captured by a {@link FileReadBackend}.
 * @returns One `{n}: {line}` row per line, or `"(no content)"` when empty.
 * @see {@link readTool}
 * @group Built-in Tools
 */
export function formatFileContent(result: FileReadResult): string {
  if (result.lines.length === 0) return "(no content)";
  return result.lines.map((line, i) => `${result.startLine + i}: ${line}`).join("\n");
}

/**
 * Render glob matches into the single text block handed to the model.
 *
 * @remarks
 * One path per line; an empty result set yields a clear note instead of an empty
 * string.
 *
 * @param paths - The matching paths returned by a {@link FileReadBackend}.
 * @returns One path per line, or `"No files matched."` when empty.
 * @see {@link globTool}
 * @group Built-in Tools
 */
export function formatGlobMatches(paths: string[]): string {
  return paths.length > 0 ? paths.join("\n") : "No files matched.";
}
