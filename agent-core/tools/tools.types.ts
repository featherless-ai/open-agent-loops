/**
 * The tool seam.
 *
 * @remarks
 * A tool bundles a name, a description, a Zod schema for its arguments, and an
 * `execute` handler. The loop validates arguments against the schema before
 * calling `execute` (see {@link defineTool | ./tools}), so handlers can trust
 * their input.
 *
 * @module
 */

import { z } from "zod";

/**
 * How a tool runs relative to its sibling calls in the same turn.
 *
 * @remarks
 * - `Parallel` (default) lets the loop run it alongside others.
 * - `Sequential` forces the whole batch to run one-at-a-time.
 *
 * @group Defining Tools
 */
export enum ExecutionMode {
  /** Run alongside sibling calls in the same turn; the default. */
  Parallel = "parallel",
  /** Force the whole batch of calls in the turn to run one-at-a-time. */
  Sequential = "sequential",
}

/**
 * What a tool hands back to the loop.
 *
 * @group Defining Tools
 */
export interface ToolResult {
  /** Text content folded back into the conversation as the tool result. */
  content: string;
  /** Optional structured payload (not sent to the model, useful for hooks). */
  details?: unknown;
  /** When true, the loop stops after this tool result (a "final answer" tool). */
  terminate?: boolean;
}

/**
 * Per-call context the loop passes to a tool's `execute` handler.
 *
 * @group Defining Tools
 */
export interface ToolContext {
  /** Identifier of the specific tool call being executed. */
  toolCallId: string;
  /** Forwarded from the run so a cooperating handler can abort in-flight work. */
  signal?: AbortSignal;
}

/**
 * A tool the agent loop can call: name, description, argument schema, and handler.
 *
 * @remarks
 * Author tools through {@link defineTool} so the `args` parameter of `execute`
 * is inferred from `parameters` rather than the default `z.ZodType`.
 *
 * @typeParam S - The Zod schema type for the tool's arguments.
 * @see {@link defineTool}
 * @see {@link ToolResult}
 * @group Defining Tools
 */
export interface Tool<S extends z.ZodType = z.ZodType> {
  /** Unique tool name advertised to the model. */
  name: string;
  /** Human/model-readable description of what the tool does. */
  description: string;
  /** Zod schema for the tool's arguments; also converted to JSON Schema for the model. */
  parameters: S;
  /** Run the tool against validated `args`, returning its result. */
  execute(args: z.infer<S>, ctx: ToolContext): ToolResult | Promise<ToolResult>;
  /** See {@link ExecutionMode}. Defaults to `Parallel`. */
  executionMode?: ExecutionMode;
}
