/**
 * Runnable example: a multi-turn chat loop against a real model.
 *
 * Mirrors the "Multi-turn chat loop" section of the docs. The same `runAgent`
 * call from the single-turn loop, wrapped in a read-input loop that reuses
 * one `memory` + `sessionId` — so every turn remembers the ones before it.
 * Type `exit` (or an empty line) to quit.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/multi-turn-chat/multi-turn-chat.ts
 */
// #region chat-loop
import { AgentEventType, defineTool, runAgent, SessionMemoryStore } from "../../agent-loop-core/index.ts";
import type { AgentEvent } from "../../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
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

const model = new OpenAICompatibleModel({
  apiKey,
  model: modelId,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
  thinking: "on", // stream the reasoning channel so `render` actually shows it
});

// The same named renderer as the single-turn loop — it handles every event the
// loop emits.
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


const memory = new SessionMemoryStore(); // one store, reused every turn
const sessionId = "chat"; //               same id every turn → one conversation
const rl = createInterface({ input, output });

while (true) {
  const prompt = (await rl.question("\nyou › ")).trim();
  if (prompt === "" || prompt === "exit") break;

  process.stdout.write("bot › ");
  await runAgent({ model, memory, sessionId, prompt, tools: [weather], onEvent: render });
}
rl.close();
// #endregion
