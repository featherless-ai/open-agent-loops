/**
 * Tracing tutorial — Step 1: attach a passive Tracer.
 *
 * One growing program, built up across examples/tracing-tutorial/step1..3.ts —
 * each step is the previous file plus a few lines (highlighted in the docs).
 * Here: the multi-turn chat loop with a `Tracer` riding the same `onEvent` seam
 * the renderer already uses, so the loop never knows it's observed. At the end
 * of each turn we print the folded trajectory.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/tracing-tutorial/step1.ts
 *   you › what's the weather in Paris?
 */
// #region step1
import { AgentEventType, defineTool, runAgent, SessionMemoryStore, Tracer } from "../../agent-core/index.ts"; // [!code highlight]
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

const baseURL = process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1";

const weather = defineTool({
  name: "weather",
  description: "Get the current weather for a city.",
  parameters: z.object({ city: z.string().describe("City to look up.") }),
  execute: async ({ city }) => ({ content: `Sunny in ${city}` }),
});

const model = new OpenAICompatibleModel({ apiKey, model: modelId, baseURL, thinking: "on" });

// Stream the run to the human, the same as any chat loop.
function render(e: AgentEvent) {
  switch (e.type) {
    case AgentEventType.ReasoningDelta:
      process.stdout.write(`\x1b[2m${e.text}\x1b[22m`);
      break;
    case AgentEventType.TextDelta:
      process.stdout.write(e.text);
      break;
    case AgentEventType.ToolStart:
      console.log(`\n→ ${e.toolName}(${JSON.stringify(e.args)})`);
      break;
    case AgentEventType.ToolEnd:
      console.log(`← ${e.toolName} [${e.isError ? "error" : "ok"}]: ${e.result}`);
      break;
  }
}

// A Tracer is a passive observer: `tracer.sink` is an EventSink — the exact
// shape `onEvent` already takes. Fan each event to both (render for the human,
// sink for the record) and the loop is none the wiser.
const tracer = new Tracer(); // [!code highlight:2]
const observe = (e: AgentEvent) => { render(e); tracer.sink(e); };

const memory = new SessionMemoryStore(); // one store + one id → one conversation
const sessionId = "tracing";
const rl = createInterface({ input, output });

while (true) {
  const prompt = (await rl.question("\nyou › ")).trim();
  if (prompt === "" || prompt === "exit") break;

  process.stdout.write("bot › ");
  await runAgent({ model, memory, sessionId, prompt, tools: [weather], onEvent: observe }); // [!code highlight]

  // End of turn: the same trace, folded into (action → observation) pairs. // [!code highlight:2]
  console.log(`\n${tracer.formatTrajectory()}`);
}
rl.close();
// #endregion
