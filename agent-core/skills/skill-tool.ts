/**
 * The skill-disclosure tools over a {@link SkillRegistry}: `skill` (Level 2 —
 * instructions) and `skill_resource` (Level 3 — bundled reference material).
 *
 * @remarks
 * Disclosure is just a tool result. When the model calls `skill({ name })`, that
 * returns the skill's `instructions` (plus a manifest of any resources) as the
 * tool result `content`, so the body lands in context exactly when the model
 * decides the skill is relevant — and not before. Calling
 * `skill_resource({ skill, name })` then loads one resource's content the same
 * way. No loop change: both are ordinary {@link Tool}s.
 *
 * @module
 */

import { z } from "zod";
import { defineTool } from "../tools/tools";
import type { Tool } from "../tools/tools.types";
import type { Skill } from "./skills.types";
import type { SkillRegistry } from "./registry";

/**
 * Render a skill's resource manifest: one `- name: description` line per
 * resource, under a heading that tells the model how to load them. Empty string
 * when the skill has no resources, so it appends cleanly to the instructions.
 */
function resourceManifest(skill: Skill): string {
  const names = Object.keys(skill.resources ?? {});
  if (names.length === 0) return "";
  const lines = names.map((name) => `- ${name}: ${skill.resources![name]!.description}`);
  return [
    "",
    "## Resources",
    "Load one with the `skill_resource` tool when you need it:",
    ...lines,
  ].join("\n");
}

/**
 * Build the `skill` tool bound to a {@link SkillRegistry}.
 *
 * @remarks
 * Pair it with the registry's catalog in the system prompt and its flattened
 * tools in the run:
 *
 * ```ts
 * tools: [skillTool(skills), ...skills.tools(), ...coreTools]
 * ```
 *
 * Calling it with an unknown name throws (listing what *is* registered); the loop
 * turns that into the usual `isError` tool result the model can read and recover
 * from, rather than failing the run.
 *
 * @param registry - The {@link SkillRegistry} whose skills can be disclosed.
 * @returns A {@link Tool} named `skill` ready to pass to the agent loop.
 * @see {@link SkillRegistry}
 * @group Skills
 */
export function skillTool(registry: SkillRegistry): Tool {
  return defineTool({
    name: "skill",
    description:
      "Load a skill's instructions by name before using it. " +
      "Returns the skill's how-to guidance; call this when a listed skill fits the task.",
    parameters: z.object({
      name: z.string().describe("The skill to load, by name (from the catalog)."),
    }),
    execute: ({ name }) => {
      const skill = registry.get(name);
      if (!skill) {
        const available = registry.names().join(", ") || "(none)";
        throw new Error(`Unknown skill "${name}". Available skills: ${available}.`);
      }
      // Append the resource manifest so the model learns what it can load next —
      // names + descriptions only, never the resource bodies (Level 3 stays lazy).
      return { content: skill.instructions + resourceManifest(skill) };
    },
  });
}

/**
 * Build the `skill_resource` tool bound to a {@link SkillRegistry}: Level 3
 * disclosure, loading one of a skill's bundled resources on demand.
 *
 * @remarks
 * Add it alongside {@link skillTool} when any of your skills declare
 * {@link Skill.resources | resources}:
 *
 * ```ts
 * tools: [skillTool(skills), skillResourceTool(skills), ...skills.tools()]
 * ```
 *
 * The model only learns a resource exists from the manifest {@link skillTool}
 * appends to a skill's instructions, then calls `skill_resource({ skill, name })`
 * to pull its content. The {@link SkillResource.load | load} thunk runs only here,
 * so an unused resource costs nothing — not even the read. An unknown skill or
 * resource throws (listing what *is* available); the loop turns that into the
 * usual `isError` tool result the model can recover from.
 *
 * @param registry - The {@link SkillRegistry} whose resources can be loaded.
 * @returns A {@link Tool} named `skill_resource` ready to pass to the agent loop.
 * @see {@link skillTool}
 * @see {@link SkillResource}
 * @group Skills
 */
export function skillResourceTool(registry: SkillRegistry): Tool {
  return defineTool({
    name: "skill_resource",
    description:
      "Load a named resource bundled with a skill (reference docs, data, a form template). " +
      "Returns the resource's content; call it when a skill's instructions point you to one.",
    parameters: z.object({
      skill: z.string().describe("The skill that owns the resource (from the catalog)."),
      name: z.string().describe("The resource to load, by name (from the skill's manifest)."),
    }),
    execute: async ({ skill: skillName, name }) => {
      const skill = registry.get(skillName);
      if (!skill) {
        const available = registry.names().join(", ") || "(none)";
        throw new Error(`Unknown skill "${skillName}". Available skills: ${available}.`);
      }
      const resource = skill.resources?.[name];
      if (!resource) {
        const available = Object.keys(skill.resources ?? {}).join(", ") || "(none)";
        throw new Error(
          `Skill "${skillName}" has no resource "${name}". Available resources: ${available}.`,
        );
      }
      return { content: await resource.load() };
    },
  });
}
