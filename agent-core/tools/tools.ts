/**
 * Helpers for the tool seam (interfaces in {@link Tool | ./tools.types}):
 * {@link defineTool} to author a tool with inferred argument types, plus the
 * loop's {@link toToolSpec} and {@link validateToolArguments}.
 *
 * @remarks
 * The loop validates arguments against the schema before calling `execute`, so
 * handlers can trust their input.
 *
 * @module
 */

import { z } from "zod";
import type { ToolArguments, ToolCall } from "../types";
import type { ToolSpec } from "../model.types";
import type { Tool } from "./tools.types";

/**
 * Author a tool while preserving the schema's inferred argument type for `execute`.
 *
 * @remarks
 * This is an identity function at runtime — it returns its argument unchanged.
 * Its only job is to bind the generic `S` to the supplied Zod schema so that the
 * `args` parameter of `execute` is typed as `z.infer<S>` instead of the default
 * `z.ZodType`. Always author tools through this helper to get that inference.
 *
 * @typeParam S - The Zod schema type for the tool's arguments.
 * @param tool - The tool definition, including its argument schema and `execute` handler.
 * @returns The same tool, typed so `execute` receives fully-inferred arguments.
 * @see {@link Tool}
 * @example
 * ```ts
 * import { z } from "zod";
 * import { defineTool } from "@open-agent-os/core/tools/tools";
 *
 * const addTool = defineTool({
 *   name: "add",
 *   description: "Add two numbers.",
 *   parameters: z.object({ a: z.number(), b: z.number() }),
 *   // `args` is inferred as { a: number; b: number }
 *   execute: (args) => ({ content: String(args.a + args.b) }),
 * });
 * ```
 * @group Defining Tools
 */
export function defineTool<S extends z.ZodType>(tool: Tool<S>): Tool<S> {
  return tool;
}

/**
 * Convert a tool to the spec shape the model client advertises.
 *
 * @remarks
 * The tool's Zod schema is converted to JSON Schema (via `z.toJSONSchema`),
 * which is the form function-calling models expect on the wire.
 *
 * @param tool - The tool to advertise to the model.
 * @returns A {@link ToolSpec} carrying the tool's name, description, and JSON Schema parameters.
 * @see {@link Tool}
 * @see {@link defineTool}
 * @example
 * ```ts
 * import { toToolSpec } from "@open-agent-os/core/tools/tools";
 *
 * const spec = toToolSpec(addTool);
 * // spec.parameters is a JSON Schema object describing { a, b }
 * await modelClient.complete({ messages, tools: [spec] });
 * ```
 * @group Defining Tools
 */
export function toToolSpec(tool: Tool): ToolSpec {
  return {
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.parameters),
  };
}

/**
 * Parse and schema-check a tool call, reporting success without throwing.
 *
 * @remarks
 * The single source of truth for validating a call's arguments: the call carries
 * them as a JSON *string* (the OpenAI wire format), so this JSON-parses first,
 * then schema-checks. Used directly to decide whether a call is well-formed (e.g.
 * before presenting it to the permission gate) when an exception would be
 * awkward; {@link validateToolArguments} is the throwing wrapper over it. The
 * `error` message on failure carries the same diagnostic that wrapper throws.
 *
 * @param tool - The tool whose schema the call is checked against.
 * @param call - The model-emitted tool call, whose `function.arguments` is a JSON string.
 * @returns `{ ok: true, value }` with the parsed arguments on success, or `{ ok: false, error }` — naming the failing JSON or schema paths — on a malformed call.
 * @see {@link validateToolArguments}
 * @group Defining Tools
 */
export function tryValidateToolArguments(
  tool: Tool,
  call: ToolCall,
): { ok: true; value: ToolArguments } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = parseArgumentsJson(call.function.arguments);
  } catch {
    return {
      ok: false,
      error: `Arguments for tool "${call.function.name}" are not valid JSON: ${call.function.arguments}`,
    };
  }
  const parsed = tool.parameters.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Invalid arguments for tool "${tool.name}": ${issues}` };
  }
  // Object by construction: function-calling schemas are JSON Schema objects.
  return { ok: true, value: parsed.data as ToolArguments };
}

/**
 * Validate a tool call against the tool's schema, returning the parsed arguments.
 *
 * @remarks
 * The throwing counterpart of {@link tryValidateToolArguments}: it delegates the
 * parse-and-check there and throws the reported `error` on failure. The loop
 * converts that thrown error into an error tool-result rather than crashing the
 * run.
 *
 * @param tool - The tool whose schema the call is checked against.
 * @param call - The model-emitted tool call, whose `function.arguments` is a JSON string.
 * @returns The parsed, schema-valid arguments as an object.
 * @throws `Error` if the arguments are not valid JSON.
 * @throws `Error` if the parsed arguments fail the tool's Zod schema (the message lists the failing paths).
 * @see {@link tryValidateToolArguments} for the non-throwing variant.
 * @group Defining Tools
 */
export function validateToolArguments(tool: Tool, call: ToolCall): ToolArguments {
  const parsed = tryValidateToolArguments(tool, call);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/**
 * Best-effort parse of a call's wire arguments into an object, for observation.
 *
 * @remarks
 * Used for the `tool_start` event — independent of any tool/schema, so it works
 * even for an unknown tool. Malformed or non-object JSON yields `{}`; shape
 * enforcement is {@link validateToolArguments}' job, just before the tool runs.
 *
 * @param call - The model-emitted tool call, whose `function.arguments` is a JSON string.
 * @returns The parsed arguments object, or `{}` when the JSON is malformed or not an object.
 * @see {@link validateToolArguments}
 * @group Defining Tools
 */
export function parseToolArguments(call: ToolCall): ToolArguments {
  let raw: unknown;
  try {
    raw = parseArgumentsJson(call.function.arguments);
  } catch {
    return {};
  }
  return raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as ToolArguments)
    : {};
}

/**
 * Parse a tool call's JSON-string arguments; an empty string means no arguments.
 *
 * @param raw - The raw `function.arguments` string from a tool call.
 * @returns The parsed JSON value, or `{}` when `raw` is empty.
 * @internal
 */
function parseArgumentsJson(raw: string): unknown {
  return raw ? JSON.parse(raw) : {};
}
