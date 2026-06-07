/**
 * Helpers for the tool seam (interfaces in `./tools.types`): `defineTool` to
 * author a tool with inferred argument types, plus the loop's `toToolSpec` and
 * `validateToolArguments`. The loop validates arguments against the schema
 * before calling `execute`, so handlers can trust their input.
 */

import { z } from "zod";
import type { ToolCall } from "../types";
import type { ToolSpec } from "../model.types";
import type { Tool } from "./tools.types";

/** Identity helper that preserves the schema's inferred type for `execute`. */
export function defineTool<S extends z.ZodType>(tool: Tool<S>): Tool<S> {
  return tool;
}

/** Convert a tool to the spec shape the model client advertises. */
export function toToolSpec(tool: Tool): ToolSpec {
  return {
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.parameters),
  };
}

/**
 * Validate a tool call's raw arguments against the tool's schema.
 * Throws a descriptive Error on failure; the loop converts that into an
 * error tool-result rather than crashing the run.
 */
export function validateToolArguments(tool: Tool, call: ToolCall): unknown {
  const parsed = tool.parameters.safeParse(call.arguments);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid arguments for tool "${tool.name}": ${issues}`);
  }
  return parsed.data;
}
