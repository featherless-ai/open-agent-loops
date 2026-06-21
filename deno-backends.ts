/**
 * A real, sandboxed host backend for the `code_execution` built-in, implemented
 * against the Deno runtime. Like `bun-backends.ts`, it deliberately lives OUTSIDE
 * `agent-core/`: the core owns the tool's model-facing contract but refuses to
 * ship the dangerous part — actually running model-written code (see
 * `agent-core/tools/builtin/builtin.types.ts`). This file is the *consumer*
 * filling the `CodeExecutionBackend` seam.
 *
 * Why Deno: it is deny-by-default. The spawned `deno run` gets NO file, network,
 * or environment access unless granted via `allow` below, so this is a real
 * isolation boundary with zero infrastructure — unlike `bunShellBackend`, which
 * runs unsandboxed. The trade-offs to know:
 *   - JS/TS ONLY. Deno executes JavaScript/TypeScript natively. Running another
 *     language would mean granting subprocess access to spawn its interpreter,
 *     and Deno does NOT sandbox that child — so this backend rejects non-JS/TS
 *     rather than pretend. Multi-language isolation is a container backend's job.
 *   - Process-level, not a VM. Deno's permission model is enforced by the
 *     runtime, not the kernel; for genuinely hostile code prefer a
 *     container/microVM behind the same seam.
 *   - Requires the `deno` binary on PATH (https://deno.com).
 */

import type { ToolContext } from "./agent-core/tools/tools.types.ts";
import type {
  CodeExecutionBackend,
  CodeExecutionRequest,
  CodeExecutionResult,
} from "./agent-core/tools/builtin/builtin.types.ts";

/**
 * Deno permission grants. Everything is denied unless listed here. `true` grants
 * the capability broadly; an array scopes it (paths, hosts, or variable names).
 * There is deliberately no `run` (subprocess) grant — that is the escape hatch
 * out of the sandbox, and this backend keeps it shut.
 */
export interface DenoPermissions {
  /** Filesystem reads — `true` for all, or specific paths. → `--allow-read`. */
  read?: boolean | string[];
  /** Filesystem writes — `true` for all, or specific paths. → `--allow-write`. */
  write?: boolean | string[];
  /** Network — `true` for all, or specific `host[:port]` entries. → `--allow-net`. */
  net?: boolean | string[];
  /** Environment variables — `true` for all, or specific names. → `--allow-env`. */
  env?: boolean | string[];
}

/** Options for {@link denoCodeExecutionBackend}. */
export interface DenoBackendOptions {
  /** Working directory the code runs under. Defaults to the process cwd. */
  cwd?: string;
  /** Permission grants; omitted means a fully locked-down run (compute only). */
  allow?: DenoPermissions;
}

/**
 * A sandboxed {@link CodeExecutionBackend}: pipes the snippet to `deno run` over
 * stdin with an explicit, deny-by-default permission set, capturing stdout,
 * stderr, and the exit code. The loop's abort signal is forwarded so a cancelled
 * run also kills the child process. Rejects any language other than
 * JavaScript/TypeScript — see the file header for why.
 */
export function denoCodeExecutionBackend(options: DenoBackendOptions = {}): CodeExecutionBackend {
  return {
    async exec(request: CodeExecutionRequest, ctx: ToolContext): Promise<CodeExecutionResult> {
      const ext = denoExt(request.language);
      if (!ext) {
        throw new Error(
          `denoCodeExecutionBackend runs JavaScript/TypeScript only; got language ` +
            `"${request.language}". Use a container backend for other languages.`,
        );
      }
      if (Bun.which("deno") === null) {
        throw new Error("denoCodeExecutionBackend requires the `deno` binary on PATH (https://deno.com).");
      }

      // --no-prompt: a permission the code wasn't granted fails closed instead of
      // hanging on an interactive prompt. --ext: tell Deno how to parse stdin.
      const args = ["deno", "run", "--no-prompt", "--quiet", `--ext=${ext}`];
      args.push(...toPermissionFlags(options.allow));
      args.push("-"); // read the program from stdin

      const proc = Bun.spawn(args, {
        cwd: options.cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        signal: ctx.signal,
      });
      proc.stdin.write(request.code);
      proc.stdin.end();

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
 * Map a requested language to the Deno stdin content type, or `null` if Deno
 * cannot run it natively (the caller turns that into a model-visible error).
 */
function denoExt(language: string): "ts" | "js" | null {
  switch (language.toLowerCase()) {
    case "typescript":
    case "ts":
      return "ts";
    case "javascript":
    case "js":
      return "js";
    default:
      return null;
  }
}

/**
 * Translate a {@link DenoPermissions} grant into `--allow-*` flags. An omitted or
 * empty grant emits no flag, leaving that capability denied.
 */
function toPermissionFlags(allow: DenoPermissions = {}): string[] {
  const flags: string[] = [];
  const grant = (name: string, value: boolean | string[] | undefined): void => {
    if (value === true) flags.push(`--allow-${name}`);
    else if (Array.isArray(value) && value.length > 0) flags.push(`--allow-${name}=${value.join(",")}`);
  };
  grant("read", allow.read);
  grant("write", allow.write);
  grant("net", allow.net);
  grant("env", allow.env);
  return flags;
}
