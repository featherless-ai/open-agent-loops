/**
 * Real host backends for the built-in tools, implemented against the Bun
 * runtime. These deliberately live OUTSIDE `agent-core/`: the core owns each
 * tool's model-facing contract but refuses to ship the dangerous part — actually
 * running a command or touching a filesystem (see
 * `agent-core/tools/builtin/builtin.types.ts`). This file is the *consumer*
 * filling those seams, the same role `main.ts` plays for the model.
 *
 * SECURITY: `bunShellBackend` runs arbitrary commands on this machine with no
 * sandbox. Only hand the resulting tool to a model you trust, or route it through
 * the permission gate in `agent-core/permissions`.
 */

import type { ToolContext } from "./agent-core/tools/tools.types.ts";
import type {
  SearchBackend,
  SearchMatch,
  SearchQuery,
  ShellBackend,
  ShellResult,
} from "./agent-core/tools/builtin/builtin.types.ts";

/** Options shared by both backends — chiefly the working directory to run in. */
interface BackendOptions {
  /** Directory commands and searches run under. Defaults to the process cwd. */
  cwd?: string;
}

/**
 * A real {@link ShellBackend}: runs the command through `sh -c` via `Bun.spawn`,
 * capturing stdout, stderr, and the exit code. The loop's abort signal is
 * forwarded so a cancelled run also kills the child process.
 */
export function bunShellBackend(options: BackendOptions = {}): ShellBackend {
  return {
    async exec(command: string, ctx: ToolContext): Promise<ShellResult> {
      const proc = Bun.spawn(["sh", "-c", command], {
        cwd: options.cwd,
        stdout: "pipe",
        stderr: "pipe",
        signal: ctx.signal,
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, exitCode };
    },
  };
}

/**
 * A real {@link SearchBackend}: shells out to ripgrep (`rg`) and parses its
 * `path:line:text` output into {@link SearchMatch} records. When `rg` is not on
 * the PATH it falls back to POSIX `grep -rHnE`, which emits the same
 * `path:line:text` shape so the parser below is unchanged. Both tools exit 1 when
 * there are simply no matches (not an error); only exit codes above 1 are real
 * failures and are surfaced as a thrown error.
 */
export function bunSearchBackend(options: BackendOptions = {}): SearchBackend {
  return {
    async search(query: SearchQuery, ctx: ToolContext): Promise<SearchMatch[]> {
      const hasRipgrep = Bun.which("rg") !== null;
      const args = hasRipgrep
        ? ["rg", "--line-number", "--no-heading", "--with-filename"]
        : ["grep", "-rHnE"];
      if (query.ignoreCase) args.push(hasRipgrep ? "--ignore-case" : "-i");
      if (hasRipgrep) {
        args.push("--regexp", query.pattern);
        if (query.path) args.push(query.path);
      } else {
        // grep needs the pattern before the path; `-e` guards patterns with `-`.
        args.push("-e", query.pattern, query.path ?? ".");
      }

      const proc = Bun.spawn(args, {
        cwd: options.cwd,
        stdout: "pipe",
        stderr: "pipe",
        signal: ctx.signal,
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode > 1) {
        throw new Error(`search failed: ${stderr.trim() || `${args[0]} exited ${exitCode}`}`);
      }

      const matches: SearchMatch[] = [];
      // Split on `\r?\n`: CRLF files (like war-and-peace.txt) would otherwise
      // leave a trailing `\r` that the row regex's `$` won't match, silently
      // dropping every result.
      for (const row of stdout.split(/\r?\n/)) {
        if (!row) continue;
        // Non-greedy path grabs the minimal text before the first `:<digits>:`.
        const parsed = row.match(/^(.+?):(\d+):(.*)$/);
        if (!parsed) continue;
        matches.push({ path: parsed[1], line: Number(parsed[2]), text: parsed[3] });
        if (query.maxResults && matches.length >= query.maxResults) break;
      }
      return matches;
    },
  };
}
