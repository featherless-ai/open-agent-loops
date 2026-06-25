/**
 * Host backends for the built-in `shell` + `search` tools, implemented against
 * Node's `node:child_process`. Unlike `bun-backends.ts` (Bun-only) these run on
 * **both** runtimes the kitchen-sink targets: Node (`next dev`) and Deno (`deno
 * task dev`, via Deno's `node:` compatibility). The core owns each
 * tool's model-facing contract but refuses to ship the dangerous part — actually
 * spawning a process — so this file is the consumer filling those seams.
 *
 * SECURITY: `nodeShellBackend` runs arbitrary commands with no sandbox. Only hand
 * the resulting tool to a model you trust, or gate it (this example does, via the
 * permission gate in `lib/agent.ts`).
 */
import { spawn } from "node:child_process";

interface BackendOptions {
  /** Directory commands and searches run under. Defaults to the process cwd. */
  cwd?: string;
}

interface ToolCtx {
  signal?: AbortSignal;
}

/** Spawn a process, collect stdout/stderr/exit; forwards the loop's abort signal. */
function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string; exitCode: number; spawnError?: NodeJS.ErrnoException }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, signal: opts.signal });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (spawnError: NodeJS.ErrnoException) =>
      resolve({ stdout, stderr, exitCode: -1, spawnError }),
    );
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }));
  });
}

/** A real ShellBackend: runs the command through `sh -c`, capturing output. */
export function nodeShellBackend(options: BackendOptions = {}) {
  return {
    async exec(command: string, ctx: ToolCtx) {
      const { stdout, stderr, exitCode, spawnError } = await run("sh", ["-c", command], {
        cwd: options.cwd,
        signal: ctx.signal,
      });
      if (spawnError) throw new Error(`shell failed to start: ${spawnError.message}`);
      return { stdout, stderr, exitCode };
    },
  };
}

/**
 * A real SearchBackend: shells out to ripgrep (`rg`), falling back to POSIX
 * `grep -rHnE` when `rg` is not installed (both emit the same `path:line:text`
 * shape). Exit 1 means "no matches" (not an error); only codes > 1 are failures.
 */
export function nodeSearchBackend(options: BackendOptions = {}) {
  return {
    async search(
      query: { pattern: string; path?: string; ignoreCase?: boolean; maxResults?: number },
      ctx: ToolCtx,
    ) {
      const rgArgs = ["--line-number", "--no-heading", "--with-filename"];
      if (query.ignoreCase) rgArgs.push("--ignore-case");
      rgArgs.push("--regexp", query.pattern);
      if (query.path) rgArgs.push(query.path);

      let res = await run("rg", rgArgs, { cwd: options.cwd, signal: ctx.signal });
      // `rg` missing → fall back to grep (pattern before path; `-e` guards `-`).
      if (res.spawnError?.code === "ENOENT") {
        const grepArgs = ["-rHnE"];
        if (query.ignoreCase) grepArgs.push("-i");
        grepArgs.push("-e", query.pattern, query.path ?? ".");
        res = await run("grep", grepArgs, { cwd: options.cwd, signal: ctx.signal });
      }
      if (res.spawnError) throw new Error(`search failed to start: ${res.spawnError.message}`);
      if (res.exitCode > 1) {
        throw new Error(`search failed: ${res.stderr.trim() || `exited ${res.exitCode}`}`);
      }

      const matches: { path: string; line: number; text: string }[] = [];
      // Split on \r?\n so CRLF files don't leave a trailing \r that drops rows.
      for (const row of res.stdout.split(/\r?\n/)) {
        if (!row) continue;
        const parsed = row.match(/^(.+?):(\d+):(.*)$/);
        if (!parsed) continue;
        matches.push({ path: parsed[1], line: Number(parsed[2]), text: parsed[3] });
        if (query.maxResults && matches.length >= query.maxResults) break;
      }
      return matches;
    },
  };
}
