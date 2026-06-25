/**
 * A scriptable `ShellBackend` for tests — the shell counterpart to
 * {@link MockModelClient}.
 *
 * @remarks
 * This is a testing utility. It records every command (and the context it ran
 * with, so tests can assert the loop forwarded the abort signal) and returns a
 * fixed result, or one chosen per command by a function.
 *
 * @module
 */

import type { ToolContext } from "../tools/tools.types";
import type { ShellBackend, ShellResult } from "../tools/builtin/builtin.types";

/**
 * The responder driving a {@link MockShellBackend}: either a fixed result or a
 * function that decides per command.
 *
 * @group Testing
 */
export type ShellResponder = ShellResult | ((command: string) => ShellResult);

/** Default success result returned when no responder is supplied. */
const OK: ShellResult = { stdout: "", stderr: "", exitCode: 0 };

/**
 * Scriptable {@link ShellBackend} that records commands and replays results.
 *
 * @remarks
 * This is a testing utility. Every `(command, ctx)` pair is captured in
 * {@link calls} for assertions — including `ctx.signal`, so tests can verify the
 * loop forwarded the abort signal. Results come from the {@link ShellResponder}
 * supplied at construction.
 *
 * @example
 * ```ts
 * const shell = new MockShellBackend({ stdout: "ok", stderr: "", exitCode: 0 });
 * const result = await shell.exec("ls", ctx);
 * expect(result.stdout).toBe("ok");
 * expect(shell.calls[0].command).toBe("ls");
 * ```
 *
 * @see {@link MockModelClient}
 * @group Testing
 */
export class MockShellBackend implements ShellBackend {
  /** Every (command, ctx) the tool ran, in order — handy for assertions. */
  readonly calls: Array<{ command: string; ctx: ToolContext }> = [];

  /**
   * @param responder - A fixed result or a per-command function. Defaults to a
   * success result (`{ stdout: "", stderr: "", exitCode: 0 }`).
   */
  constructor(private readonly responder: ShellResponder = OK) {}

  /**
   * Record the command and context, then return the scripted result.
   * @param command - The shell command issued by the tool.
   * @param ctx - Per-call context; captured for assertions.
   * @returns The result from the responder.
   */
  async exec(command: string, ctx: ToolContext): Promise<ShellResult> {
    this.calls.push({ command, ctx });
    return typeof this.responder === "function" ? this.responder(command) : this.responder;
  }
}
