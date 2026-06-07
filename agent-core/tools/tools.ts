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
 * Validate a tool call against the tool's schema. The call carries its
 * arguments as a JSON *string* (the OpenAI wire format), so we JSON-parse it
 * first, then schema-check. Throws a descriptive Error on bad JSON or a schema
 * mismatch; the loop converts that into an error tool-result rather than
 * crashing the run.
 */
export function validateToolArguments(tool: Tool, call: ToolCall): unknown {
  let raw: unknown;
  try {
    raw = parseArgumentsJson(call.function.arguments);
  } catch {
    throw new Error(
      `Arguments for tool "${call.function.name}" are not valid JSON: ${call.function.arguments}`,
    );
  }
  const parsed = tool.parameters.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid arguments for tool "${tool.name}": ${issues}`);
  }
  return parsed.data;
}

/**
 * Non-throwing counterpart of `validateToolArguments`: parse + schema-check and
 * report success without raising. Used to decide whether a call is well-formed
 * (e.g. before presenting it to the permission gate).
 */
export function tryValidateToolArguments(
  tool: Tool,
  call: ToolCall,
): { ok: true; value: unknown } | { ok: false } {
  let raw: unknown;
  try {
    raw = parseArgumentsJson(call.function.arguments);
  } catch {
    return { ok: false };
  }
  const parsed = tool.parameters.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

/** Parse a tool call's JSON-string arguments; empty string means no arguments. */
function parseArgumentsJson(raw: string): unknown {
  return raw ? JSON.parse(raw) : {};
}
