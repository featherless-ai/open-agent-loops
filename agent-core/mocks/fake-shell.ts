/**
 * A scriptable ShellBackend for tests — the shell counterpart to
 * `FakeModelClient`. It records every command (and the context it ran with, so
 * tests can assert the loop forwarded the abort signal) and returns a fixed
 * result, or one chosen per command by a function.
 */

import type { ToolContext } from "../tools/tools.types";
import type { ShellBackend, ShellResult } from "../tools/builtin/builtin.types";

/** Either a fixed result or a function that decides per command. */
export type ShellResponder = ShellResult | ((command: string) => ShellResult);

const OK: ShellResult = { stdout: "", stderr: "", exitCode: 0 };

export class FakeShellBackend implements ShellBackend {
  /** Every (command, ctx) the tool ran, in order — handy for assertions. */
  readonly calls: Array<{ command: string; ctx: ToolContext }> = [];

  constructor(private readonly responder: ShellResponder = OK) {}

  async exec(command: string, ctx: ToolContext): Promise<ShellResult> {
    this.calls.push({ command, ctx });
    return typeof this.responder === "function" ? this.responder(command) : this.responder;
  }
}
