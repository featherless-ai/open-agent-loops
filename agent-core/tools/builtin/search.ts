/**
 * The `search` tool: SDK-owned wiring over the {@link SearchBackend} seam.
 *
 * @remarks
 * The consumer supplies the backend (the filesystem/regex part — see
 * {@link SearchBackend | builtin.types.ts}); this fixes the model-facing
 * contract (name, schema, result shaping) so the model always sees a stable
 * `search`.
 *
 * @module
 */

import { z } from "zod";
import { defineTool } from "../tools";
import type { Tool } from "../tools.types";
import type { SearchBackend, SearchMatch } from "./builtin.types";

/**
 * Build a `search` tool bound to a backend.
 *
 * @remarks
 * Read-only, so it keeps the default parallel execution mode (a batch of
 * searches can run concurrently). Results are shaped by
 * {@link formatSearchResults}.
 *
 * @param backend - The {@link SearchBackend} that performs the actual regex search.
 * @returns A {@link Tool} named `search` ready to pass to the agent loop or a {@link ToolRegistry}.
 * @see {@link SearchBackend}
 * @see {@link ToolRegistry}
 * @example
 * ```ts
 * const tool = searchTool(mySearchBackend);
 * await runAgent({ ...opts, tools: [tool] });
 * // The model can now call: search({ pattern: "TODO", path: "src", ignoreCase: true })
 * ```
 * @group Built-in Tools
 */
export function searchTool(backend: SearchBackend): Tool {
  return defineTool({
    name: "search",
    description:
      "Search file contents by regular expression. Returns matching lines as path:line: text.",
    parameters: z.object({
      pattern: z
        .string()
        .describe("A regular expression matched against file contents."),
      path: z
        .string()
        .optional()
        .describe("File or directory to search under. Defaults to the backend's root."),
      ignoreCase: z.boolean().optional().describe("Case-insensitive matching."),
      maxResults: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Upper bound on the number of matches returned."),
    }),
    execute: async (query, ctx) => ({
      content: formatSearchResults(await backend.search(query, ctx)),
    }),
  });
}

/**
 * Render search matches into the single text block handed to the model.
 *
 * @remarks
 * Each match becomes one `path:line: text` line; an empty result set yields a
 * clear note instead of an empty string.
 *
 * @param matches - The matches returned by a {@link SearchBackend}.
 * @returns One `path:line: text` line per match, or `"No matches found."` when empty.
 * @see {@link searchTool}
 * @group Built-in Tools
 */
export function formatSearchResults(matches: SearchMatch[]): string {
  if (matches.length === 0) return "No matches found.";
  return matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n");
}
