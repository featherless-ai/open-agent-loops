/**
 * A scriptable `FileWriteBackend` for tests — the mutating filesystem
 * counterpart to {@link MockModelClient}.
 *
 * @remarks
 * This is a testing utility. It records every write and edit (and the context
 * each ran with) and returns scripted results — no real file is ever touched.
 *
 * @module
 */

import type { ToolContext } from "../tools/tools.types";
import type {
  FileEditRequest,
  FileEditResult,
  FileWriteBackend,
  FileWriteRequest,
  FileWriteResult,
} from "../tools/builtin/builtin.types";

/**
 * The responder driving a {@link MockFileWriteBackend}'s `write`: either a fixed
 * result or a function that decides per request.
 *
 * @group Testing
 */
export type FileWriteResponder =
  | FileWriteResult
  | ((request: FileWriteRequest) => FileWriteResult);

/**
 * The responder driving a {@link MockFileWriteBackend}'s `edit`: either a fixed
 * result or a function that decides per request.
 *
 * @group Testing
 */
export type FileEditResponder =
  | FileEditResult
  | ((request: FileEditRequest) => FileEditResult);

/** Default write responder: echoes the path and the content's UTF-8 byte length. */
const DEFAULT_WRITE: FileWriteResponder = (request) => ({
  path: request.path,
  bytesWritten: new TextEncoder().encode(request.content).length,
});

/** Default edit responder: reports a successful replacement of the target string. */
const DEFAULT_EDIT: FileEditResponder = (request) => ({
  path: request.path,
  replaced: true,
});

/**
 * Scriptable {@link FileWriteBackend} that records calls and replays results.
 *
 * @remarks
 * This is a testing utility. Every `write` is captured in {@link writes} and
 * every `edit` in {@link edits} — including `ctx`, so tests can verify the loop
 * forwarded the abort signal. Results come from the responders supplied at
 * construction; by default a write reports the content's byte length and an edit
 * reports success.
 *
 * @example
 * ```ts
 * const fs = new MockFileWriteBackend();
 * const out = await fs.write({ path: "a.txt", content: "hello" }, ctx);
 * expect(out.bytesWritten).toBe(5);
 * expect(fs.writes[0]?.request.path).toBe("a.txt");
 * ```
 *
 * @see {@link MockModelClient}
 * @group Testing
 */
export class MockFileWriteBackend implements FileWriteBackend {
  /** Every (request, ctx) passed to `write`, in order — handy for assertions. */
  readonly writes: Array<{ request: FileWriteRequest; ctx: ToolContext }> = [];
  /** Every (request, ctx) passed to `edit`, in order — handy for assertions. */
  readonly edits: Array<{ request: FileEditRequest; ctx: ToolContext }> = [];

  /**
   * @param writeResponder - A fixed result or a per-request function. Defaults to reporting the content's byte length.
   * @param editResponder - A fixed result or a per-request function. Defaults to a successful replacement.
   */
  constructor(
    private readonly writeResponder: FileWriteResponder = DEFAULT_WRITE,
    private readonly editResponder: FileEditResponder = DEFAULT_EDIT,
  ) {}

  /**
   * Record the request and context, then return the scripted result.
   * @param request - The write request issued by the tool.
   * @param ctx - Per-call context; captured for assertions.
   * @returns The result from the responder.
   */
  async write(request: FileWriteRequest, ctx: ToolContext): Promise<FileWriteResult> {
    this.writes.push({ request, ctx });
    return typeof this.writeResponder === "function"
      ? this.writeResponder(request)
      : this.writeResponder;
  }

  /**
   * Record the request and context, then return the scripted result.
   * @param request - The edit request issued by the tool.
   * @param ctx - Per-call context; captured for assertions.
   * @returns The result from the responder.
   */
  async edit(request: FileEditRequest, ctx: ToolContext): Promise<FileEditResult> {
    this.edits.push({ request, ctx });
    return typeof this.editResponder === "function"
      ? this.editResponder(request)
      : this.editResponder;
  }
}
