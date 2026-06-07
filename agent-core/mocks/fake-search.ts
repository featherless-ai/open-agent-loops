/**
 * A scriptable SearchBackend for tests — the search counterpart to
 * `FakeModelClient`. It records every query and returns a fixed list of matches,
 * or one chosen per query by a function.
 */

import type { ToolContext } from "../tools/tools.types";
import type { SearchBackend, SearchMatch, SearchQuery } from "../tools/builtin/builtin.types";

/** Either fixed matches or a function that decides per query. */
export type SearchResponder = SearchMatch[] | ((query: SearchQuery) => SearchMatch[]);

export class FakeSearchBackend implements SearchBackend {
  /** Every query the tool ran, in order — handy for assertions. */
  readonly queries: SearchQuery[] = [];

  constructor(private readonly responder: SearchResponder = []) {}

  async search(query: SearchQuery, _ctx: ToolContext): Promise<SearchMatch[]> {
    this.queries.push(query);
    return typeof this.responder === "function" ? this.responder(query) : this.responder;
  }
}
