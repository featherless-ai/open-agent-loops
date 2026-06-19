/**
 * The skill seam — a named bundle of instructions and tools the agent pulls in
 * on demand.
 *
 * @remarks
 * A skill carries three things: a `description` (cheap, kept in the system
 * catalog every turn so the model can decide *when* the skill applies), the full
 * `instructions` (expensive, disclosed into context only when the skill is
 * invoked), and the `tools` it contributes. Disclosure rides the existing tool
 * seam: a built-in `skill` tool returns a skill's `instructions` as its result,
 * so revealing a skill is just a tool call — the loop is untouched.
 *
 * Composition, not a loop dependency: you collect skills in a
 * {@link SkillRegistry}, then feed `runAgent` the flattened `system` catalog and
 * `Tool[]` it already understands.
 *
 * @see {@link SkillRegistry} — build a catalog and resolve skills by name.
 * @see `./skill-tool` for the `skillTool` that performs disclosure.
 * @module
 */

import type { Tool } from "../tools/tools.types";

/**
 * A bundled reference the model can pull in on demand — the third level of
 * progressive disclosure, below {@link Skill.instructions}.
 *
 * @remarks
 * A skill's {@link SkillResource.description | description} is advertised when the
 * skill is disclosed (cheap), but the content is produced by
 * {@link SkillResource.load | load} only when the model calls the `skill_resource`
 * tool — so a skill can carry a large reference doc, dataset, or form template
 * that never enters context, or even gets read, unless it is actually used.
 *
 * @see {@link Skill.resources}
 * @group Skills
 */
export interface SkillResource {
  /**
   * One-line summary, advertised alongside the skill's instructions so the model
   * can decide whether this resource is worth loading. Always cheap.
   */
  description: string;
  /**
   * Produce the resource's content. Called ONLY when the resource is loaded via
   * the `skill_resource` tool — defer the expensive read (file, dataset, network)
   * to here so it costs nothing until accessed. Async so a load can fetch.
   */
  load: () => string | Promise<string>;
}

/**
 * A named bundle of instructions and tools the agent can pull in on demand.
 *
 * @remarks
 * Progressive disclosure in three levels: the model sees
 * {@link Skill.description | description} in the catalog every turn (Level 1),
 * {@link Skill.instructions | instructions} only after it invokes the skill
 * (Level 2), and a {@link Skill.resources | resource}'s content only after it
 * loads that resource by name (Level 3).
 *
 * @see {@link SkillRegistry}
 * @group Skills
 */
export interface Skill {
  /** Unique name; advertised in the catalog and invoked by the `skill` tool. */
  name: string;
  /** One-line summary the model reads to decide relevance. Always in context. */
  description: string;
  /** Full how-to body. Injected into context only when the skill is invoked. */
  instructions: string;
  /** Tools this skill contributes to the run. Optional: a skill may be pure knowledge. */
  tools?: Tool[];
  /**
   * Reference material the skill can pull in on demand (Level 3). Keyed by
   * resource name: each is advertised by its
   * {@link SkillResource.description | description} when the skill is disclosed,
   * and loaded by the `skill_resource` tool only when the model needs it.
   */
  resources?: Record<string, SkillResource>;
}
