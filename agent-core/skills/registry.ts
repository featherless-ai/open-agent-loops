/**
 * {@link SkillRegistry} — a named collection of skills you build once, then
 * resolve from by name and flatten into the catalog + tools `runAgent` consumes.
 *
 * @module
 */

import type { Tool } from "../tools/tools.types";
import type { Skill } from "./skills.types";

/**
 * A named collection of skills you build once and resolve from by name.
 *
 * @remarks
 * Composition helper, NOT a loop dependency — the same stance as `ToolRegistry`.
 * `runAgent` never sees a registry: you hand it the {@link SkillRegistry.catalog}
 * string for the system prompt and the {@link SkillRegistry.tools} array for the
 * run. Because it only produces a `string` and a `Tool[]`, you can adopt it
 * incrementally and drop it anytime without touching the loop.
 *
 * Fail fast (per the project's error-handling rule): registering a duplicate
 * name ({@link SkillRegistry.register}) or resolving an unknown one
 * ({@link SkillRegistry.resolve}) throws a descriptive error rather than silently
 * overwriting or dropping a skill — both are almost always wiring bugs.
 *
 * @see {@link Skill}
 * @example
 * ```ts
 * const skills = new SkillRegistry([helloSkill, githubSkill]);
 *
 * await runAgent({
 *   ...opts,
 *   system: `${baseSystem}\n\n## Available skills\n${skills.catalog()}`,
 *   tools: [skillTool(skills), ...skills.tools(), ...coreTools],
 * });
 * ```
 * @group Skills
 */
export class SkillRegistry {
  // Map preserves insertion order, so `list()`/`catalog()` are deterministic.
  private readonly skills = new Map<string, Skill>();

  /**
   * Create a registry, optionally seeded with an initial set of skills.
   *
   * @param skills - Initial skills to register, in order. Defaults to empty.
   * @throws `Error` If two seed skills share a name.
   */
  constructor(skills: Skill[] = []) {
    for (const skill of skills) this.register(skill);
  }

  /**
   * Add a skill, keyed by its name.
   *
   * @param skill - The skill to register.
   * @returns `this`, so registrations can chain.
   * @throws `Error` If a skill with the same name is already registered.
   */
  register(skill: Skill): this {
    if (this.skills.has(skill.name)) {
      throw new Error(`A skill named "${skill.name}" is already registered.`);
    }
    this.skills.set(skill.name, skill);
    return this;
  }

  /**
   * Report whether a skill with this name is registered.
   *
   * @param name - The skill name to look up.
   * @returns `true` if a skill with this name is registered.
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * Get the skill registered under a name.
   *
   * @param name - The skill name to look up.
   * @returns The registered skill, or `undefined` if there is none.
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * List every registered skill, in registration order.
   *
   * @returns All registered skills.
   */
  list(): Skill[] {
    return [...this.skills.values()];
  }

  /**
   * List every registered skill name, in registration order.
   *
   * @returns All registered skill names.
   */
  names(): string[] {
    return [...this.skills.keys()];
  }

  /**
   * Resolve a list of names to their skills, in the order requested.
   *
   * @param names - The skill names to resolve, in order.
   * @returns The matching skills, in the requested order.
   * @throws `Error` On the first name that is not registered; the message lists the available names.
   */
  resolve(names: string[]): Skill[] {
    return names.map((name) => {
      const skill = this.skills.get(name);
      if (!skill) {
        const available = this.names().join(", ") || "(none)";
        throw new Error(`Unknown skill "${name}". Registered skills: ${available}.`);
      }
      return skill;
    });
  }

  /**
   * Render the always-in-context catalog: one `- name: description` line per skill.
   *
   * @remarks
   * This is the cheap half of progressive disclosure — names and descriptions the
   * model reads every turn to decide which skill to invoke. The expensive
   * `instructions` are disclosed only when the `skill` tool is called.
   *
   * @returns A newline-joined list of `- name: description` lines, in registration order.
   */
  catalog(): string {
    return this.list()
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join("\n");
  }

  /**
   * Flatten every registered skill's tools into a single array.
   *
   * @remarks
   * Pass the result (alongside the `skill` tool) as `runAgent`'s `tools`. Order
   * is registration order, then each skill's own tool order. Duplicate tool names
   * are not de-duplicated here — if that matters, feed the result through a
   * `ToolRegistry`, which throws on duplicates.
   *
   * @returns Every skill's contributed tools, concatenated.
   */
  tools(): Tool[] {
    return this.list().flatMap((skill) => skill.tools ?? []);
  }
}
