/**
 * The `search` tool: SDK-owned wiring over the {@link SearchBackend} seam. The
 * consumer supplies the backend (the filesystem/regex part — see
 * `builtin.types.ts`); this fixes the model-facing contract (name, schema,
 * result shaping) so the model always sees a stable `search`.
 */

import { z } from "zod";
import { defineTool } from "../tools";
import type { Tool } from "../tools.types";
import type { SearchBackend, SearchMatch } from "./builtin.types";

/**
 * Build a `search` tool bound to `backend`. Read-only, so it keeps the default
 * parallel execution mode (a batch of searches can run concurrently).
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

/** Render matches as `path:line: text`, one per line; a clear note when empty. */
export function formatSearchResults(matches: SearchMatch[]): string {
  if (matches.length === 0) return "No matches found.";
  return matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join("\n");
}
