import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineTool } from "../tools/tools";
import { isToolMessage } from "../types";
import { runAgent } from "../primitives/loop";
import { SessionMemoryStore } from "../memory/session-memory";
import { MockModelClient } from "../mocks/mock-model";
import { SkillRegistry } from "../skills/registry";
import { skillTool } from "../skills/skill-tool";
import type { Skill } from "../skills/skills.types";

// The hello-world skill: a description (always shown), instructions (disclosed on
// demand), and one trivial in-process tool it contributes.
const greet = defineTool({
  name: "greet",
  description: "Return a friendly greeting for a name.",
  parameters: z.object({ name: z.string() }),
  execute: ({ name }) => ({ content: `Hello, ${name}!` }),
});

const HELLO_INSTRUCTIONS = "To greet someone, call greet({ name }) and report its result verbatim.";

const helloSkill: Skill = {
  name: "hello",
  description: "Greet a person by name.",
  instructions: HELLO_INSTRUCTIONS,
  tools: [greet],
};

describe("hello-world skill", () => {
  // Base case: the registry produces the cheap half (catalog) and the tools.
  test("base: registry exposes a catalog line and the skill's tools", () => {
    const skills = new SkillRegistry([helloSkill]);
    expect(skills.catalog()).toBe("- hello: Greet a person by name.");
    expect(skills.tools().map((t) => t.name)).toEqual(["greet"]);
  });

  // Base case: invoking the skill tool discloses the expensive half on demand.
  test("base: the skill tool discloses the instructions on demand", async () => {
    const tool = skillTool(new SkillRegistry([helloSkill]));
    const result = await tool.execute({ name: "hello" }, { toolCallId: "t1" });
    expect(result.content).toBe(HELLO_INSTRUCTIONS);
  });

  // Edge: an unknown skill fails fast, listing what is registered.
  test("edge: the skill tool throws on an unknown skill and lists the catalog", () => {
    const tool = skillTool(new SkillRegistry([helloSkill]));
    expect(() => tool.execute({ name: "ghost" }, { toolCallId: "t1" })).toThrow(
      /Unknown skill "ghost".*hello/s,
    );
  });

  // The headline: progressive disclosure end-to-end through the real loop.
  // The model sees only the catalog, invokes the skill, THEN gets the
  // instructions, THEN runs the skill's tool — zero network, fully scripted.
  test("e2e: catalog up front, instructions disclosed on invoke, then the tool runs", async () => {
    const skills = new SkillRegistry([helloSkill]);
    const model = new MockModelClient([
      { toolCalls: [{ name: "skill", arguments: { name: "hello" } }] },
      { toolCalls: [{ name: "greet", arguments: { name: "World" } }] },
      { text: "Hello, World!" },
    ]);

    const result = await runAgent({
      model,
      memory: new SessionMemoryStore(),
      sessionId: "hello-demo",
      system: `You are a demo agent.\n\n## Available skills\n${skills.catalog()}`,
      tools: [skillTool(skills), ...skills.tools()],
      prompt: "Say hello to World.",
    });

    // What the model saw up front is the catalog — NOT the instructions.
    expect(model.requests[0]?.system).toContain("- hello: Greet a person by name.");
    expect(model.requests[0]?.system).not.toContain(HELLO_INSTRUCTIONS);

    // Disclosure happened: the instructions arrived as a tool result mid-run.
    const toolResults = result.newMessages.filter(isToolMessage);
    expect(toolResults.some((m) => m.content === HELLO_INSTRUCTIONS)).toBe(true);

    // The skill's own tool then ran, and the model produced the final answer.
    expect(toolResults.some((m) => m.content === "Hello, World!")).toBe(true);
    expect(result.messages.at(-1)?.content).toBe("Hello, World!");
    expect(result.steps).toBe(3);
  });
});
