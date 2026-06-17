/**
 * Runnable example: a single-turn agent loop against a real model.
 *
 * Mirrors the "Single-turn agent loop" section of the docs — one local `weather`
 * tool, a typed `render` over every AgentEvent, and one prompt read from the
 * terminal.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/single-turn-loop/single-turn-loop.ts
 */

import { AgentEventType, defineTool, runAgent, SessionMemoryStore } from "../../agent-core/index.ts";
import type { AgentEvent } from "../../agent-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-core/providers/openai-compatible.ts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { z } from "zod";

const apiKey = process.env.LLM_API_KEY;
const modelId = process.env.LLM_MODEL;
if (!apiKey || !modelId) {
  console.error("Set LLM_API_KEY and LLM_MODEL (see .env.example).");
  process.exit(1);
}

const weather = defineTool({
  name: "weather",
  description: "Get the current weather for a city.",
  parameters: z.object({ city: z.string().describe("City to look up.") }),
  execute: async ({ city }) => {
    // Replace with a real API call to fetch the weather.
    return { content: `Sunny in ${city}` };
  },
});

// Batteries included: the OpenAI-compatible client, pointed at any endpoint.
const model = new OpenAICompatibleModel({
  apiKey,
  model: modelId,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
  thinking: "on", // stream the reasoning channel so `render` actually shows it
});

// onEvent is your renderer. The loop is headless and emits a typed AgentEvent
// stream — `render` handles every event that flows through the loop.
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

// Read the question from the terminal instead of hardcoding it — type something
// like "What's the weather in Paris?" when prompted.
const rl = createInterface({ input, output });
const prompt = await rl.question("you › ");
rl.close();

const result = await runAgent({
  model,
  memory: new SessionMemoryStore(), // batteries-included in-memory conversation store
  sessionId: "single-turn-demo",
  prompt, // whatever you typed above
  tools: [weather],
  onEvent: render, // the named renderer defined above
});

console.log(`\n${result.messages.at(-1)?.content}`);
