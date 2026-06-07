import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineTool, toToolSpec, validateToolArguments } from "../tools/tools";
import type { ToolCall } from "../types";

const adder = defineTool({
  name: "add",
  description: "Add two numbers",
  parameters: z.object({ a: z.number(), b: z.number() }),
  execute: ({ a, b }) => ({ content: String(a + b) }),
});

const call = (args: Record<string, unknown>): ToolCall => ({
  id: "c1",
  type: "function",
  function: { name: "add", arguments: JSON.stringify(args) },
});

/** A call whose wire arguments are a raw (possibly malformed) JSON string. */
const rawCall = (argsJson: string): ToolCall => ({
  id: "c1",
  type: "function",
  function: { name: "add", arguments: argsJson },
});

describe("tools", () => {
  // Base case: valid arguments parse and pass through typed.
  test("base: valid arguments validate and return parsed data", () => {
    expect(validateToolArguments(adder, call({ a: 2, b: 3 }))).toEqual({ a: 2, b: 3 });
  });

  // Edge: wrong types are rejected with a descriptive error.
  test("edge: invalid argument types throw with a helpful message", () => {
    expect(() => validateToolArguments(adder, call({ a: "x", b: 3 }))).toThrow(
      /Invalid arguments for tool "add"/,
    );
  });

  // Edge: missing required fields are rejected.
  test("edge: missing required arguments throw", () => {
    expect(() => validateToolArguments(adder, call({ a: 1 }))).toThrow(/add/);
  });

  // Edge: malformed JSON in the wire arguments throws before schema-checking.
  test("edge: non-JSON arguments throw a JSON error", () => {
    expect(() => validateToolArguments(adder, rawCall("{not json"))).toThrow(/not valid JSON/);
  });

  // Edge: an empty arguments string is treated as no arguments ({}).
  test("edge: empty arguments string means no args", () => {
    const noArgTool = defineTool({
      name: "noop",
      description: "no args",
      parameters: z.object({}),
      execute: () => ({ content: "ok" }),
    });
    expect(validateToolArguments(noArgTool, rawCall(""))).toEqual({});
  });

  // Edge: Zod coercion/stripping behavior — unknown keys are dropped, not kept.
  test("edge: unknown extra keys are stripped by the schema", () => {
    const parsed = validateToolArguments(adder, call({ a: 1, b: 2, junk: true })) as any;
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  // Edge: the model-facing spec carries name, description, and JSON Schema.
  test("edge: toToolSpec emits a JSON Schema for the parameters", () => {
    const spec = toToolSpec(adder);
    expect(spec.name).toBe("add");
    expect(spec.description).toBe("Add two numbers");
    // Zod v4 -> JSON Schema produces an object schema with the two props.
    const schema = spec.parameters as any;
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toEqual(["a", "b"]);
  });

  // Edge: defineTool is an identity helper (preserves the object).
  test("edge: defineTool returns the same tool object", () => {
    expect(defineTool(adder)).toBe(adder);
  });
});
