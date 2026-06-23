/**
 * The `web_search` and `web_fetch` tools: SDK-owned wiring over the
 * {@link WebBackend} seam.
 *
 * @remarks
 * The consumer supplies the backend (the online-service part — see
 * {@link WebBackend | builtin.types.ts}); this fixes the model-facing contract
 * (names, schemas, result shaping) so the model always sees stable `web_search`
 * and `web_fetch` tools regardless of which engine or fetcher backs them. Both
 * are read-only, the network counterpart to `read`/`glob`'s wiring in
 * `./file-read`.
 *
 * @module
 */

import { z } from "zod";
import { defineTool } from "../tools";
import type { Tool } from "../tools.types";
import type { WebBackend, WebFetchResult, WebSearchResult } from "./builtin.types";

/**
 * Build a `web_search` tool bound to a backend.
 *
 * @remarks
 * Read-only, so it keeps the default parallel execution mode (a batch of
 * searches can run concurrently). Results are shaped by
 * {@link formatWebSearchResults}.
 *
 * @param backend - The {@link WebBackend} whose `search` performs the lookup.
 * @returns A {@link Tool} named `web_search` ready to pass to the agent loop or a {@link ToolRegistry}.
 * @see {@link WebBackend}
 * @see {@link webFetchTool}
 * @example
 * ```ts
 * const tool = webSearchTool(myWebBackend);
 * await runAgent({ ...opts, tools: [tool] });
 * // The model can now call: web_search({ query: "agentic loop", maxResults: 5 })
 * ```
 * @group Built-in Tools
 */
export function webSearchTool(backend: WebBackend): Tool {
  return defineTool({
    name: "web_search",
    description:
      "Search the web. Returns ranked results as numbered title / url / snippet blocks.",
    parameters: z.object({
      query: z.string().describe("The free-text search query."),
      maxResults: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Upper bound on the number of results to return."),
    }),
    execute: async (query, ctx) => ({
      content: formatWebSearchResults(await backend.search(query, ctx)),
    }),
  });
}

/**
 * Build a `web_fetch` tool bound to a backend.
 *
 * @remarks
 * Read-only by intent, but it dereferences a model-supplied URL — see the SSRF
 * note on {@link WebBackend}. Keeps the default parallel execution mode; results
 * are shaped by {@link formatWebFetchResult}.
 *
 * @param backend - The {@link WebBackend} whose `fetch` performs the request.
 * @returns A {@link Tool} named `web_fetch` ready to pass to the agent loop or a {@link ToolRegistry}.
 * @see {@link WebBackend}
 * @see {@link webSearchTool}
 * @example
 * ```ts
 * const tool = webFetchTool(myWebBackend);
 * await runAgent({ ...opts, tools: [tool] });
 * // The model can now call: web_fetch({ url: "https://example.com" })
 * ```
 * @group Built-in Tools
 */
export function webFetchTool(backend: WebBackend): Tool {
  return defineTool({
    name: "web_fetch",
    description:
      "Fetch one URL and return its contents as text. Prefixed with the final URL, status, and content type.",
    parameters: z.object({
      url: z.string().describe("Absolute URL to fetch."),
      maxBytes: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Upper bound on the number of content bytes to return."),
    }),
    execute: async (request, ctx) => ({
      content: formatWebFetchResult(await backend.fetch(request, ctx)),
    }),
  });
}

/**
 * Render web-search hits into the single text block handed to the model.
 *
 * @remarks
 * Each hit becomes a numbered `[n] title — url` line followed by its snippet; an
 * empty result set yields a clear note instead of an empty string.
 *
 * @param results - The hits returned by a {@link WebBackend}'s `search`.
 * @returns One numbered block per hit, or `"No results found."` when empty.
 * @see {@link webSearchTool}
 * @group Built-in Tools
 */
export function formatWebSearchResults(results: WebSearchResult[]): string {
  if (results.length === 0) return "No results found.";
  return results
    .map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${r.snippet}`)
    .join("\n\n");
}

/**
 * Render a fetched page into the single text block handed to the model.
 *
 * @remarks
 * A short header (final URL, status, content type) precedes the extracted body,
 * so the model can see redirects and non-200 responses rather than guessing from
 * the text alone.
 *
 * @param result - The contents captured by a {@link WebBackend}'s `fetch`.
 * @returns A header followed by the body, with `(no content)` standing in for an empty body.
 * @see {@link webFetchTool}
 * @group Built-in Tools
 */
export function formatWebFetchResult(result: WebFetchResult): string {
  const header = `${result.url} (${result.status} ${result.contentType})`;
  const body = result.text === "" ? "(no content)" : result.text;
  return `${header}\n\n${body}`;
}
