/**
 * A scriptable `SearchBackend` for tests — the search counterpart to
 * {@link MockModelClient}.
 *
 * @remarks
 * This is a testing utility. It records every query and returns a fixed list of
 * matches, or one chosen per query by a function.
 *
 * @module
 */

import type { ToolContext } from "../tools/tools.types";
import type { SearchBackend, SearchMatch, SearchQuery } from "../tools/builtin/builtin.types";

/**
 * The responder driving a {@link MockSearchBackend}: either fixed matches or a
 * function that decides per query.
 *
 * @group Testing
 */
export type SearchResponder = SearchMatch[] | ((query: SearchQuery) => SearchMatch[]);

/**
 * Scriptable {@link SearchBackend} that records queries and replays matches.
 *
 * @remarks
 * This is a testing utility. Every query is captured in {@link queries} for
 * assertions; results come from the {@link SearchResponder} supplied at
 * construction.
 *
 * @example
 * ```ts
 * const search = new MockSearchBackend([
 *   { path: "a.txt", line: 1, text: "match" },
 * ]);
 * const matches = await search.search({ pattern: "match" }, ctx);
 * expect(search.queries).toHaveLength(1);
 * ```
 *
 * @see {@link MockModelClient}
 * @group Testing
 */
export class MockSearchBackend implements SearchBackend {
  /** Every query the tool ran, in order — handy for assertions. */
  readonly queries: SearchQuery[] = [];

  /**
   * @param responder - Fixed matches or a per-query function. Defaults to `[]`.
   */
  constructor(private readonly responder: SearchResponder = []) {}

  /**
   * Record the query and return the scripted matches.
   * @param query - The search query issued by the tool.
   * @param _ctx - The tool context (unused; present to satisfy the seam).
   * @returns The matches from the responder.
   */
  async search(query: SearchQuery, _ctx: ToolContext): Promise<SearchMatch[]> {
    this.queries.push(query);
    return typeof this.responder === "function" ? this.responder(query) : this.responder;
  }
}
