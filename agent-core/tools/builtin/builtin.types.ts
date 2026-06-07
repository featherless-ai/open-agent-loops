/**
 * Capability seams for the built-in tools. These follow the same rule as
 * `ModelClient` and `Memory`: the SDK owns the *contract* (the tool's name, Zod
 * schema, and how its result folds back into the loop), and leaves a hole the
 * consumer MUST implement. "You can call it, you must implement it."
 *
 * Why a seam and not a shipped implementation? A real `exec` or file search
 * binds to a host (a process runtime, a filesystem, an OS) and is the most
 * dangerous capability an agent has. The core is deliberately environment-
 * agnostic (see `docs/architecture.md`), so it CANNOT safely ship the backend —
 * forcing the consumer to provide it is the correct boundary, not a limitation.
 * Test doubles live in `../../mocks` (`MockShellBackend`, `MockSearchBackend`),
 * the same way `MockModelClient` stands in for a real model in tests.
 */

import type { ToolContext } from "../tools.types";

/** The outcome of running one shell command. */
export interface ShellResult {
  /** Standard output captured from the command. */
  stdout: string;
  /** Standard error captured from the command. */
  stderr: string;
  /** Process exit status; 0 conventionally means success. */
  exitCode: number;
}

/**
 * The shell capability seam — implement this against your host (e.g. Node's
 * `child_process`, a container, a remote sandbox). The `ctx.signal` is forwarded
 * from the loop so a cooperating backend can abort an in-flight command.
 *
 * SECURITY: this runs arbitrary commands on whatever host you wire up. There is
 * no sandbox here — that is the backend's responsibility. Route the resulting
 * tool through the permission gate (`../../permissions`) before granting it to a
 * model you do not fully trust.
 */
export interface ShellBackend {
  exec(command: string, ctx: ToolContext): Promise<ShellResult>;
}

/** A single content match from a regex search. */
export interface SearchMatch {
  /** Path of the file the match was found in. */
  path: string;
  /** 1-based line number of the matching line. */
  line: number;
  /** The text of the matching line. */
  text: string;
}

/** A regex search request handed to the backend. */
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
 * The regex-search capability seam — implement this against your host (e.g.
 * ripgrep, a filesystem walk, an index). Read-only by nature, so it is far less
 * dangerous than {@link ShellBackend}, but it still touches a filesystem the
 * core knows nothing about, hence a seam rather than a shipped implementation.
 */
export interface SearchBackend {
  search(query: SearchQuery, ctx: ToolContext): Promise<SearchMatch[]>;
}
