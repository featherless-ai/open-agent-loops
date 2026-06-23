/**
 * Runnable example: a "hello world" skill.
 *
 * Shows the whole skill seam end-to-end against a real model — the catalog in the
 * system prompt (cheap, always shown), the `skill` tool that discloses a skill's
 * instructions on demand (the expensive half), and a skill that contributes one
 * tool (`greet`).
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/hello-skill.ts
 */

import {
  AgentEventType,
  defineTool,
  runAgent,
  SessionMemoryStore,
  SkillRegistry,
  skillTool,
} from "../agent-loop-core/index.ts";
import type { AgentEvent, Skill } from "../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../agent-loop-core/providers/openai-compatible.ts";
import { z } from "zod";

// One trivial in-process tool the skill contributes.
const greet = defineTool({
  name: "greet",
  description: "Return a friendly greeting for a name.",
  parameters: z.object({ name: z.string().describe("Who to greet.") }),
  execute: ({ name }) => ({ content: `Hello, ${name}!` }),
});

// The hello-world skill: a one-line description (always in the catalog),
// instructions (disclosed only when invoked), and the greet tool.
const helloSkill: Skill = {
  name: "hello",
  description: "Greet a person warmly by name.",
  instructions: [
    "To greet someone:",
    "1. Call greet({ name }) with the person's name.",
    "2. Report the greeting it returns, verbatim.",
  ].join("\n"),
  tools: [greet],
};

const skills = new SkillRegistry([helloSkill]);

// DeepSeek V4 for the demo: it tool-calls cleanly (GLM emits broken empty-key
// tool args, so it is a poor fit for a tool-driven skill walkthrough).
const model = new OpenAICompatibleModel({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
  model: process.env.LLM_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash",
  thinking: "on",
});

// Render every event the loop emits — identical to the multi-turn chat loop,
// including the dimmed reasoning (thinking) channel so you can watch Claude think.
function render(e: AgentEvent) {
  switch (e.type) {
    case AgentEventType.AgentStart:
      console.log(`▶ start · session ${e.sessionId}`);
      break;
    case AgentEventType.TurnStart:
      console.log(`\n— turn ${e.step} —`);
      break;
    case AgentEventType.ReasoningDelta:
      // The reasoning channel — dim it so it reads as distinct from the answer.
      process.stdout.write(`\x1b[2m${e.text}\x1b[22m`);
      break;
    case AgentEventType.TextDelta:
      process.stdout.write(e.text);
      break;
    case AgentEventType.Message:
      console.log(`\n· ${e.message.role} message complete`);
      break;
    case AgentEventType.ToolStart:
      console.log(`→ ${e.toolName}(${JSON.stringify(e.args)})`);
      break;
    case AgentEventType.ToolEnd:
      console.log(`← ${e.toolName} [${e.isError ? "error" : "ok"}]: ${e.result}`);
      break;
    case AgentEventType.AgentEnd:
      console.log(`\n■ done · ${e.steps} steps`);
      break;
  }
}

const result = await runAgent({
  model,
  memory: new SessionMemoryStore(),
  sessionId: "hello-skill-demo",
  // The catalog goes in the system prompt; the instructions do NOT — the model
  // pulls those in itself by calling `skill`.
  system: [
    "You are a friendly demo agent.",
    "",
    "## Available skills",
    skills.catalog(),
    "",
    "Call the `skill` tool with a skill name to load its instructions before using it.",
  ].join("\n"),
  tools: [skillTool(skills), ...skills.tools()],
  prompt: "Please say hello to Ada.",
  onEvent: render,
});

console.log(`\n${result.messages.at(-1)?.content}`);
