/**
 * Capability seams for the built-in tools.
 *
 * @remarks
 * These follow the same rule as `ModelClient` and `Memory`: the SDK owns the
 * *contract* (the tool's name, Zod schema, and how its result folds back into
 * the loop), and leaves a hole the consumer MUST implement. "You can call it,
 * you must implement it."
 *
 * Why a seam and not a shipped implementation? A real `exec` or file search
 * binds to a host (a process runtime, a filesystem, an OS) and is the most
 * dangerous capability an agent has. The core is deliberately environment-
 * agnostic (see `docs/architecture.md`), so it CANNOT safely ship the backend —
 * forcing the consumer to provide it is the correct boundary, not a limitation.
 * Test doubles live in `../../mocks` (`MockShellBackend`, `MockSearchBackend`,
 * `MockFileReadBackend`, `MockFileWriteBackend`), the same way `MockModelClient`
 * stands in for a real model in tests.
 *
 * The backing point for each built-in tool — the interface a consumer fills in —
 * is: `shell` (bash) → {@link ShellBackend}; `search` (grep) →
 * {@link SearchBackend}; `read` and `glob` → {@link FileReadBackend}; `write`
 * and `edit` → {@link FileWriteBackend}. The two filesystem seams split along the
 * danger line: reading is safe like {@link SearchBackend}, mutating is dangerous
 * like {@link ShellBackend}.
 *
 * @module
 */

import type { ToolContext } from "../tools.types";

/**
 * The outcome of running one shell command.
 *
 * @group Built-in Tools
 */
export interface ShellResult {
  /** Standard output captured from the command. */
  stdout: string;
  /** Standard error captured from the command. */
  stderr: string;
  /** Process exit status; 0 conventionally means success. */
  exitCode: number;
}

/**
 * The shell capability seam — implement this against your host.
 *
 * @remarks
 * Wire it to e.g. Node's `child_process`, a container, or a remote sandbox. The
 * `ctx.signal` is forwarded from the loop so a cooperating backend can abort an
 * in-flight command.
 *
 * SECURITY: this runs arbitrary commands on whatever host you wire up. There is
 * no sandbox here — that is the backend's responsibility. Route the resulting
 * tool through the permission gate (`../../permissions`) before granting it to a
 * model you do not fully trust.
 *
 * @see {@link ShellResult}
 * @see {@link shellTool} which wraps this seam in a model-facing tool.
 * @group Built-in Tools
 */
export interface ShellBackend {
  /**
   * Execute a shell command and capture its output.
   *
   * @param command - The shell command to run.
   * @param ctx - Per-call context; `ctx.signal` may be used to abort the command.
   * @returns The command's stdout, stderr, and exit code.
   */
  exec(command: string, ctx: ToolContext): Promise<ShellResult>;
}

/**
 * A single content match from a regex search.
 *
 * @group Built-in Tools
 */
export interface SearchMatch {
  /** Path of the file the match was found in. */
  path: string;
  /** 1-based line number of the matching line. */
  line: number;
  /** The text of the matching line. */
  text: string;
}

/**
 * A regex search request handed to the backend.
 *
 * @group Built-in Tools
 */
export interface SearchQuery {
  /** A regular expression matched against file contents. */
  pattern: string;
  /** File or directory to search under; the backend decides the default root. */
  path?: string;
  /** Case-insensitive matching when true. */
  ignoreCase?: boolean;
  /** Upper bound on the number of matches to return. */
  maxResults?: number;
}

/**
 * The regex-search capability seam — implement this against your host.
 *
 * @remarks
 * Wire it to e.g. ripgrep, a filesystem walk, or an index. Read-only by nature,
 * so it is far less dangerous than {@link ShellBackend}, but it still touches a
 * filesystem the core knows nothing about, hence a seam rather than a shipped
 * implementation.
 *
 * @see {@link SearchQuery}
 * @see {@link SearchMatch}
 * @see {@link searchTool} which wraps this seam in a model-facing tool.
 * @group Built-in Tools
 */
export interface SearchBackend {
  /**
   * Run a regex search and return the matching lines.
   *
   * @param query - The search request (pattern, optional path, flags).
   * @param ctx - Per-call context; `ctx.signal` may be used to abort the search.
   * @returns The matching lines found.
   */
  search(query: SearchQuery, ctx: ToolContext): Promise<SearchMatch[]>;
}

/**
 * The selected slice of a file's contents.
 *
 * @group Built-in Tools
 */
export interface FileReadResult {
  /** The selected lines, in order, each without its trailing newline. */
  lines: string[];
  /** 1-based number of the first returned line (echoes the resolved offset). */
  startLine: number;
}

/**
 * A request to read a slice of a file.
 *
 * @group Built-in Tools
 */
export interface FileReadRequest {
  /** Path of the file to read. */
  path: string;
  /** 1-based first line to return; the backend picks the default (conventionally line 1). */
  offset?: number;
  /** Upper bound on the number of lines to return; the backend picks the default. */
  limit?: number;
}

/**
 * A request to list files matching a glob pattern.
 *
 * @group Built-in Tools
 */
export interface GlobQuery {
  /** Glob pattern matched against file paths, e.g. `**\/*.ts`. */
  pattern: string;
  /** Directory to search under; the backend decides the default root. */
  path?: string;
}

/**
 * The read-only filesystem capability seam — implement this against your host.
 *
 * @remarks
 * Backs the two read-only file tools (`read` and `glob`). Read-only by nature,
 * so — like {@link SearchBackend} — it is far less dangerous than a mutating or
 * exec capability, but it still touches a filesystem the core knows nothing
 * about, hence a seam rather than a shipped implementation.
 *
 * Backing point: this interface is where you back `read` and `glob`, exactly the
 * way {@link SearchBackend} is where you back `search` (grep). Wire it to e.g.
 * Node's `fs`, a virtual filesystem, or a sandbox.
 *
 * @see {@link SearchBackend} — its read-only sibling; back this the same way.
 * @see {@link FileWriteBackend} — the mutating other half of the filesystem.
 * @see {@link readTool} and {@link globTool} which wrap this seam in model-facing tools.
 * @group Built-in Tools
 */
export interface FileReadBackend {
  /**
   * Read a slice of a file's contents.
   *
   * @param request - The file path plus an optional 1-based offset and line limit.
   * @param ctx - Per-call context; `ctx.signal` may be used to abort the read.
   * @returns The selected lines and the 1-based number of the first line.
   */
  read(request: FileReadRequest, ctx: ToolContext): Promise<FileReadResult>;
  /**
   * List files matching a glob pattern.
   *
   * @param query - The glob pattern and optional root directory.
   * @param ctx - Per-call context; `ctx.signal` may be used to abort the walk.
   * @returns The matching file paths.
   */
  glob(query: GlobQuery, ctx: ToolContext): Promise<string[]>;
}

/**
 * A request to write a file's full contents.
 *
 * @group Built-in Tools
 */
export interface FileWriteRequest {
  /** Path of the file to write; parent directories are created as needed. */
  path: string;
  /** Full content to write, replacing anything already there. */
  content: string;
}

/**
 * The outcome of writing a file.
 *
 * @group Built-in Tools
 */
export interface FileWriteResult {
  /** Path that was written. */
  path: string;
  /** Number of bytes written. */
  bytesWritten: number;
}

/**
 * A request to replace the first occurrence of a string in a file.
 *
 * @group Built-in Tools
 */
export interface FileEditRequest {
  /** Path of the file to edit. */
  path: string;
  /** Exact string to find. */
  oldString: string;
  /** String to replace the first occurrence with. */
  newString: string;
}

/**
 * The outcome of an edit.
 *
 * @group Built-in Tools
 */
export interface FileEditResult {
  /** Path that was edited. */
  path: string;
  /**
   * Whether the target string was found and replaced. `false` is a normal,
   * model-recoverable outcome (the string was simply absent) — NOT an error; the
   * tool surfaces it in the result so the model can retry, the same way a
   * non-zero shell exit is surfaced rather than thrown. A genuinely missing file
   * should make the backend throw, which the loop turns into an error result.
   */
  replaced: boolean;
}

/**
 * The mutating filesystem capability seam — implement this against your host.
 *
 * @remarks
 * Backs the two mutating file tools (`write` and `edit`). Like
 * {@link ShellBackend} (bash), this is a dangerous, host-binding capability — it
 * changes files on whatever host you wire up — so the core ships no
 * implementation.
 *
 * SECURITY: this overwrites and rewrites files with no sandbox of its own — that
 * is the backend's responsibility. Route the resulting tools through the
 * permission gate (`../../permissions`) before granting them to a model you do
 * not fully trust, the same advice as for {@link ShellBackend}.
 *
 * Backing point: this interface is where you back `write` and `edit`, exactly the
 * way {@link ShellBackend} is where you back `shell` (bash). Wire it to e.g.
 * Node's `fs`, a container, or a remote sandbox.
 *
 * @see {@link ShellBackend} — the other dangerous, host-binding seam; back this the same way.
 * @see {@link FileReadBackend} — the read-only other half of the filesystem.
 * @see {@link writeTool} and {@link editTool} which wrap this seam in model-facing tools.
 * @group Built-in Tools
 */
export interface FileWriteBackend {
  /**
   * Write a file's full contents, creating parent directories as needed.
   *
   * @param request - The path and the full content to write.
   * @param ctx - Per-call context; `ctx.signal` may be used to abort the write.
   * @returns The path written and the number of bytes written.
   */
  write(request: FileWriteRequest, ctx: ToolContext): Promise<FileWriteResult>;
  /**
   * Replace the first occurrence of a string in a file.
   *
   * @param request - The path plus the exact string to find and its replacement.
   * @param ctx - Per-call context; `ctx.signal` may be used to abort the edit.
   * @returns The path edited and whether the target string was found.
   */
  edit(request: FileEditRequest, ctx: ToolContext): Promise<FileEditResult>;
}
