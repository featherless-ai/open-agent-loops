/**
 * {@link ToolRegistry} — a named collection of tools you can build once and then
 * resolve from by name.
 *
 * @module
 */

import type { Tool } from "./tools.types";

/**
 * A named collection of tools you build once and resolve from by name.
 *
 * @remarks
 * Composition helper, NOT a loop dependency. `runAgent` still takes a plain
 * `Tool[]` and never sees a registry — the loop is untouched. You keep the
 * catalog here and feed the loop the array you want. Because it only produces a
 * `Tool[]`, you can adopt it incrementally and drop it anytime without touching
 * the loop.
 *
 * Why it exists: tools are authored as objects, but some callers only have
 * *names* — config, a CLI flag, or a stored list that names the tools a given
 * run may use. Those callers need a name → {@link Tool} resolver; that resolver
 * is this registry.
 *
 * Fail fast (per the project's error-handling rule): registering a duplicate
 * name ({@link ToolRegistry.register}) or resolving an unknown one
 * ({@link ToolRegistry.resolve}) throws a descriptive error rather than silently
 * overwriting or dropping a tool — both are almost always wiring bugs.
 *
 * @see {@link Tool}
 * @example
 * ```ts
 * const registry = new ToolRegistry([searchTool(backend), shellTool(backend)]);
 *
 * // every registered tool:
 * await runAgent({ ...opts, tools: registry.list() });
 *
 * // or just a named subset for this run/step:
 * await runAgent({ ...opts, tools: registry.resolve(["search"]) });
 * ```
 * @group Tool Registry
 */
export class ToolRegistry {
  // Map preserves insertion order, so `list()` is deterministic.
  private readonly tools = new Map<string, Tool>();

  /**
   * Create a registry, optionally seeded with an initial set of tools.
   *
   * @remarks
   * Each seed tool is added via {@link ToolRegistry.register}, so the same
   * duplicate-name rule applies.
   *
   * @param tools - Initial tools to register, in order. Defaults to empty.
   * @throws `Error` If two seed tools share a name.
   */
  constructor(tools: Tool[] = []) {
    for (const tool of tools) this.register(tool);
  }

  /**
   * Add a tool, keyed by its name.
   *
   * @remarks
   * Re-registration is treated as a wiring bug, not an update, so a duplicate
   * name throws rather than overwriting.
   *
   * @param tool - The tool to register.
   * @returns `this`, so registrations can chain.
   * @throws `Error` If a tool with the same name is already registered.
   */
  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`A tool named "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * Report whether a tool with this name is registered.
   *
   * @param name - The tool name to look up.
   * @returns `true` if a tool with this name is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get the tool registered under a name.
   *
   * @param name - The tool name to look up.
   * @returns The registered tool, or `undefined` if there is none.
   * @see {@link ToolRegistry.resolve} for a throwing, multi-name variant.
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * List every registered tool.
   *
   * @returns All registered tools, in registration order.
   */
  list(): Tool[] {
    return [...this.tools.values()];
  }

  /**
   * List every registered tool name.
   *
   * @returns All registered tool names, in registration order.
   */
  names(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * Resolve a list of names to their tools, in the order requested.
   *
   * @remarks
   * Throws on the first unknown name (listing what *is* available), so a caller
   * that asks for a tool that was never registered fails loudly at wiring time
   * instead of silently running without it.
   *
   * @param names - The tool names to resolve, in the order they should appear.
   * @returns The matching tools, in the requested order.
   * @throws `Error` On the first name that is not registered; the message lists the available names.
   * @see {@link ToolRegistry.get} for a non-throwing single-name lookup.
   */
  resolve(names: string[]): Tool[] {
    return names.map((name) => {
      const tool = this.tools.get(name);
      if (!tool) {
        const available = this.names().join(", ") || "(none)";
        throw new Error(`Unknown tool "${name}". Registered tools: ${available}.`);
      }
      return tool;
    });
  }
}
