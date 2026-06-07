/**
 * The tool seam. A tool bundles a name, a description, a Zod schema for its
 * arguments, and an `execute` handler. The loop validates arguments against the
 * schema before calling `execute` (see `./tools`), so handlers can trust their
 * input.
 */

import { z } from "zod";

/**
 * How a tool runs relative to its sibling calls in the same turn.
 * - `Parallel` (default) lets the loop run it alongside others.
 * - `Sequential` forces the whole batch to run one-at-a-time.
 */
export enum ExecutionMode {
  Parallel = "parallel",
  Sequential = "sequential",
}

/** What a tool hands back to the loop. */
export interface ToolResult {
  /** Text content folded back into the conversation as the tool result. */
  content: string;
  /** Optional structured payload (not sent to the model, useful for hooks). */
  details?: unknown;
  /** When true, the loop stops after this tool result (a "final answer" tool). */
  terminate?: boolean;
}

export interface ToolContext {
  toolCallId: string;
  signal?: AbortSignal;
}

export interface Tool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: S;
  execute(args: z.infer<S>, ctx: ToolContext): ToolResult | Promise<ToolResult>;
  /** See {@link ExecutionMode}. Defaults to `Parallel`. */
  executionMode?: ExecutionMode;
}
