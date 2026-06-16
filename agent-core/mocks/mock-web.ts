/**
 * A scriptable `WebBackend` for tests — the web counterpart to
 * {@link MockModelClient}.
 *
 * @remarks
 * This is a testing utility. It records every search and fetch (and the context
 * each ran with, so tests can assert the loop forwarded the abort signal) and
 * returns scripted results. There is no shipped real `WebBackend` — search and
 * fetch bind to online services — so this mock is how the web tools are exercised
 * in the suite, the same way {@link MockFileReadBackend} stands in for a real
 * filesystem.
 *
 * @module
 */

import type { ToolContext } from "../tools/tools.types";
import type {
  WebBackend,
  WebFetchRequest,
  WebFetchResult,
  WebSearchQuery,
  WebSearchResult,
} from "../tools/builtin/builtin.types";

/**
 * The responder driving a {@link MockWebBackend}'s `search`: either fixed hits or
 * a function that decides per query.
 *
 * @group Testing
 */
export type WebSearchResponder =
  | WebSearchResult[]
  | ((query: WebSearchQuery) => WebSearchResult[]);

/**
 * The responder driving a {@link MockWebBackend}'s `fetch`: either a fixed result
 * or a function that decides per request.
 *
 * @group Testing
 */
export type WebFetchResponder =
  | WebFetchResult
  | ((request: WebFetchRequest) => WebFetchResult);

/** Default empty page returned when no fetch responder is supplied. */
const EMPTY_PAGE: WebFetchResult = {
  url: "",
  status: 200,
  contentType: "text/plain",
  text: "",
};

/**
 * Scriptable {@link WebBackend} that records calls and replays results.
 *
 * @remarks
 * This is a testing utility. Every `search` is captured in {@link searches} and
 * every `fetch` in {@link fetches} — including `ctx`, so tests can verify the loop
 * forwarded the abort signal. Results come from the responders supplied at
 * construction.
 *
 * @example
 * ```ts
 * const web = new MockWebBackend([
 *   { title: "Example", url: "https://example.com", snippet: "..." },
 * ]);
 * const hits = await web.search({ query: "example" }, ctx);
 * expect(hits).toHaveLength(1);
 * expect(web.searches).toHaveLength(1);
 * ```
 *
 * @see {@link MockModelClient}
 * @see {@link MockFileReadBackend}
 * @group Testing
 */
export class MockWebBackend implements WebBackend {
  /** Every (query, ctx) passed to `search`, in order — handy for assertions. */
  readonly searches: Array<{ query: WebSearchQuery; ctx: ToolContext }> = [];
  /** Every (request, ctx) passed to `fetch`, in order — handy for assertions. */
  readonly fetches: Array<{ request: WebFetchRequest; ctx: ToolContext }> = [];

  /**
   * @param searchResponder - Fixed hits or a per-query function. Defaults to `[]`.
   * @param fetchResponder - A fixed result or a per-request function. Defaults to an empty page.
   */
  constructor(
    private readonly searchResponder: WebSearchResponder = [],
    private readonly fetchResponder: WebFetchResponder = EMPTY_PAGE,
  ) {}

  /**
   * Record the query and context, then return the scripted hits.
   * @param query - The search query issued by the tool.
   * @param ctx - Per-call context; captured for assertions.
   * @returns The hits from the responder.
   */
  async search(query: WebSearchQuery, ctx: ToolContext): Promise<WebSearchResult[]> {
    this.searches.push({ query, ctx });
    return typeof this.searchResponder === "function"
      ? this.searchResponder(query)
      : this.searchResponder;
  }

  /**
   * Record the request and context, then return the scripted page.
   * @param request - The fetch request issued by the tool.
   * @param ctx - Per-call context; captured for assertions.
   * @returns The page from the responder.
   */
  async fetch(request: WebFetchRequest, ctx: ToolContext): Promise<WebFetchResult> {
    this.fetches.push({ request, ctx });
    return typeof this.fetchResponder === "function"
      ? this.fetchResponder(request)
      : this.fetchResponder;
  }
}
