import { describe, expect, test } from "bun:test";
import { isToolMessage } from "../types";
import { runAgent } from "../primitives/loop";
import { SessionMemoryStore } from "../memory/session-memory";
import { MockModelClient } from "../mocks/mock-model";
import { SkillRegistry } from "../skills/registry";
import { skillResourceTool, skillTool } from "../skills/skill-tool";
import type { Skill } from "../skills/skills.types";

const REFERENCE_BODY = "FORMAT: a widget is { id: string, qty: number }. (...500 more lines...)";

// A skill whose instructions are small, but which bundles a large reference as a
// Level-3 resource — loaded only on demand. The `load` thunk counts its calls so
// tests can prove laziness.
function docsSkill(counter: { loads: number }): Skill {
  return {
    name: "docs",
    description: "Look up the widget format.",
    instructions: "When asked about widgets, load the `reference` resource, then answer from it.",
    resources: {
      reference: {
        description: "The full widget-format reference.",
        load: () => {
          counter.loads += 1;
          return REFERENCE_BODY;
        },
      },
    },
  };
}

describe("skill resources (Level 3 disclosure)", () => {
  // Base: the resource tool loads a resource's content on demand.
  test("base: skill_resource loads a named resource's content", async () => {
    const counter = { loads: 0 };
    const tool = skillResourceTool(new SkillRegistry([docsSkill(counter)]));
    const result = await tool.execute({ skill: "docs", name: "reference" }, { toolCallId: "t1" });
    expect(result.content).toBe(REFERENCE_BODY);
  });

  // The headline property: nothing reads the resource until it is actually loaded.
  test("base: load() is lazy — not called at registration or at skill disclosure", async () => {
    const counter = { loads: 0 };
    const skills = new SkillRegistry([docsSkill(counter)]);
    expect(counter.loads).toBe(0); // registering didn't read it

    // Disclosing the skill (Level 2) advertises the resource but does NOT load it.
    const disclosed = await skillTool(skills).execute({ name: "docs" }, { toolCallId: "t1" });
    expect(disclosed.content).not.toContain(REFERENCE_BODY);
    expect(counter.loads).toBe(0);

    // Only loading it (Level 3) runs the thunk — exactly once.
    await skillResourceTool(skills).execute({ skill: "docs", name: "reference" }, { toolCallId: "t2" });
    expect(counter.loads).toBe(1);
  });

  // Disclosing a skill advertises its resources by name + description (the manifest).
  test("base: skill disclosure appends a resource manifest, not the bodies", async () => {
    const skills = new SkillRegistry([docsSkill({ loads: 0 })]);
    const { content } = await skillTool(skills).execute({ name: "docs" }, { toolCallId: "t1" });
    expect(content).toContain("load the `reference` resource"); // the instructions
    expect(content).toContain("## Resources");
    expect(content).toContain("- reference: The full widget-format reference.");
  });

  // A skill with no resources discloses exactly its instructions — no empty manifest.
  test("base: a skill without resources discloses just its instructions", async () => {
    const plain: Skill = { name: "hi", description: "Say hi.", instructions: "Say hi." };
    const { content } = await skillTool(new SkillRegistry([plain])).execute(
      { name: "hi" },
      { toolCallId: "t1" },
    );
    expect(content).toBe("Say hi.");
  });

  // Edge: an unknown skill fails fast, listing what is registered.
  test("edge: skill_resource throws on an unknown skill and lists the catalog", async () => {
    const tool = skillResourceTool(new SkillRegistry([docsSkill({ loads: 0 })]));
    await expect(tool.execute({ skill: "ghost", name: "x" }, { toolCallId: "t1" })).rejects.toThrow(
      /Unknown skill "ghost".*docs/s,
    );
  });

  // Edge: a known skill but unknown resource fails fast, listing the skill's resources.
  test("edge: skill_resource throws on an unknown resource and lists what the skill has", async () => {
    const tool = skillResourceTool(new SkillRegistry([docsSkill({ loads: 0 })]));
    await expect(
      tool.execute({ skill: "docs", name: "ghost" }, { toolCallId: "t1" }),
    ).rejects.toThrow(/no resource "ghost".*reference/s);
  });

  // The headline, end-to-end: the model loads the skill, sees the manifest, loads
  // the resource, and only THEN does the body enter context — never before.
  test("e2e: resource body stays out of context until the model loads it", async () => {
    const counter = { loads: 0 };
    const skills = new SkillRegistry([docsSkill(counter)]);
    const model = new MockModelClient([
      { toolCalls: [{ name: "skill", arguments: { name: "docs" } }] },
      { toolCalls: [{ name: "skill_resource", arguments: { skill: "docs", name: "reference" } }] },
      { text: "A widget is { id, qty }." },
    ]);

    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "docs-demo",
      system: `You are a demo agent.\n\n## Available skills\n${skills.catalog()}`,
      tools: [skillTool(skills), skillResourceTool(skills), ...skills.tools()],
      prompt: "What's the widget format?",
    });

    // Up front the model saw only the catalog — not the reference body.
    expect(model.requests[0]?.system).toContain("- docs: Look up the widget format.");
    expect(model.requests[0]?.system).not.toContain(REFERENCE_BODY);

    // The body arrived exactly once, as the skill_resource tool result.
    const toolResults = result.newMessages.filter(isToolMessage);
    expect(toolResults.some((m) => m.content === REFERENCE_BODY)).toBe(true);
    expect(counter.loads).toBe(1);
    expect(result.messages.at(-1)?.content).toBe("A widget is { id, qty }.");
    expect(result.steps).toBe(3);
  });
});
