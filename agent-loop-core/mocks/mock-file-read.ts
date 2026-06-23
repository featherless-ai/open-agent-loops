/**
 * A scriptable `FileReadBackend` for tests — the read-only filesystem
 * counterpart to {@link MockModelClient}.
 *
 * @remarks
 * This is a testing utility. It records every read and glob (and the context
 * each ran with, so tests can assert the loop forwarded the abort signal) and
 * returns scripted results.
 *
 * @module
 */

import type { ToolContext } from "../tools/tools.types";
import type {
  FileReadBackend,
  FileReadRequest,
  FileReadResult,
  GlobQuery,
} from "../tools/builtin/builtin.types";

/**
 * The responder driving a {@link MockFileReadBackend}'s `read`: either a fixed
 * result or a function that decides per request.
 *
 * @group Testing
 */
export type FileReadResponder =
  | FileReadResult
  | ((request: FileReadRequest) => FileReadResult);

/**
 * The responder driving a {@link MockFileReadBackend}'s `glob`: either fixed
 * paths or a function that decides per query.
 *
 * @group Testing
 */
export type GlobResponder = string[] | ((query: GlobQuery) => string[]);

/** Default empty file returned when no read responder is supplied. */
const EMPTY: FileReadResult = { lines: [], startLine: 1 };

/**
 * Scriptable {@link FileReadBackend} that records calls and replays results.
 *
 * @remarks
 * This is a testing utility. Every `read` is captured in {@link reads} and every
 * `glob` in {@link globs} — including `ctx`, so tests can verify the loop
 * forwarded the abort signal. Results come from the responders supplied at
 * construction.
 *
 * @example
 * ```ts
 * const fs = new MockFileReadBackend({ lines: ["hi"], startLine: 1 }, ["a.ts"]);
 * const slice = await fs.read({ path: "a.ts" }, ctx);
 * expect(slice.lines).toEqual(["hi"]);
 * expect(fs.reads).toHaveLength(1);
 * ```
 *
 * @see {@link MockModelClient}
 * @group Testing
 */
export class MockFileReadBackend implements FileReadBackend {
  /** Every (request, ctx) passed to `read`, in order — handy for assertions. */
  readonly reads: Array<{ request: FileReadRequest; ctx: ToolContext }> = [];
  /** Every (query, ctx) passed to `glob`, in order — handy for assertions. */
  readonly globs: Array<{ query: GlobQuery; ctx: ToolContext }> = [];

  /**
   * @param readResponder - A fixed slice or a per-request function. Defaults to an empty file.
   * @param globResponder - Fixed paths or a per-query function. Defaults to `[]`.
   */
  constructor(
    private readonly readResponder: FileReadResponder = EMPTY,
    private readonly globResponder: GlobResponder = [],
  ) {}

  /**
   * Record the request and context, then return the scripted slice.
   * @param request - The read request issued by the tool.
   * @param ctx - Per-call context; captured for assertions.
   * @returns The slice from the responder.
   */
  async read(request: FileReadRequest, ctx: ToolContext): Promise<FileReadResult> {
    this.reads.push({ request, ctx });
    return typeof this.readResponder === "function"
      ? this.readResponder(request)
      : this.readResponder;
  }

  /**
   * Record the query and context, then return the scripted paths.
   * @param query - The glob query issued by the tool.
   * @param ctx - Per-call context; captured for assertions.
   * @returns The paths from the responder.
   */
  async glob(query: GlobQuery, ctx: ToolContext): Promise<string[]> {
    this.globs.push({ query, ctx });
    return typeof this.globResponder === "function"
      ? this.globResponder(query)
      : this.globResponder;
  }
}
