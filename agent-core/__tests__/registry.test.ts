import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineTool } from "../tools/tools";
import { ToolRegistry } from "../tools/registry";

const makeTool = (name: string) =>
  defineTool({
    name,
    description: `tool ${name}`,
    parameters: z.object({}),
    execute: () => ({ content: name }),
  });

describe("ToolRegistry", () => {
  // Base case: register then resolve by name returns the same tool object.
  test("base: register and get a tool by name", () => {
    const tool = makeTool("alpha");
    const registry = new ToolRegistry().register(tool);
    expect(registry.get("alpha")).toBe(tool);
    expect(registry.has("alpha")).toBe(true);
  });

  // Base case: the constructor seeds the registry from an initial array.
  test("base: constructor seeds tools", () => {
    const registry = new ToolRegistry([makeTool("a"), makeTool("b")]);
    expect(registry.names()).toEqual(["a", "b"]);
  });

  // list()/names() preserve registration order.
  test("base: list and names preserve insertion order", () => {
    const registry = new ToolRegistry().register(makeTool("z")).register(makeTool("a"));
    expect(registry.names()).toEqual(["z", "a"]);
    expect(registry.list().map((t) => t.name)).toEqual(["z", "a"]);
  });

  // resolve() returns the named subset in the order requested.
  test("base: resolve returns the requested subset in order", () => {
    const registry = new ToolRegistry([makeTool("a"), makeTool("b"), makeTool("c")]);
    expect(registry.resolve(["c", "a"]).map((t) => t.name)).toEqual(["c", "a"]);
  });

  // Edge: an unknown name is absent without throwing on the lenient accessors.
  test("edge: get/has are lenient for unknown names", () => {
    const registry = new ToolRegistry();
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.has("missing")).toBe(false);
  });

  // Edge: registering a duplicate name fails fast with a descriptive error.
  test("edge: duplicate registration throws", () => {
    const registry = new ToolRegistry([makeTool("dup")]);
    expect(() => registry.register(makeTool("dup"))).toThrow(/already registered/);
  });

  // Edge: resolving an unknown name throws and lists what is available.
  test("edge: resolve throws on an unknown name and lists registered tools", () => {
    const registry = new ToolRegistry([makeTool("a")]);
    expect(() => registry.resolve(["a", "ghost"])).toThrow(/Unknown tool "ghost".*a/s);
  });
});
