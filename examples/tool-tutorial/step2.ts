/**
 * Tools tutorial — Step 2: signal errors the model can recover from.
 *
 * Step 1 plus error handling: the `weather` tool now throws for an unknown city.
 * The loop turns the throw into an `isError` result the model reads and reacts
 * to — the run keeps going. The new lines are highlighted in the docs.
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/tool-tutorial/step2.ts
 *   you › what's the weather on the Moon?
 */
// #region step2
import {
  AgentEventType,
  defineTool,
  runAgent,
  SessionMemoryStore,
} from "../../agent-core/index.ts";
import type { AgentEvent } from "../../agent-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-core/providers/openai-compatible.ts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { z } from "zod";

const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  console.error("Set LLM_API_KEY (see .env.example).");
  process.exit(1);
}

// DeepSeek V4 tool-calls cleanly; GLM emits broken empty-key tool args.
const model = new OpenAICompatibleModel({
  apiKey,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
  model: process.env.LLM_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash",
  thinking: "on",
});

// A tiny "backend" so the tool has something real to fail on. // [!code highlight:5]
const KNOWN: Record<string, string> = {
  Paris: "Sunny, 21°C",
  Tokyo: "Rainy, 18°C",
};

const weather = defineTool({
  name: "weather",
  description: "Get the current weather for a city.",
  parameters: z.object({
    city: z.string().describe('City to look up, e.g. "Paris".'),
  }),
  execute: async ({ city }) => {
    const report = KNOWN[city]; // [!code highlight:6]
    if (!report) {
      // Throw for a hard error: only the message reaches the model, so make it
      // useful. The run does NOT crash — the model can pick another city.
      throw new Error(`No weather for "${city}". Known cities: ${Object.keys(KNOWN).join(", ")}.`);
    }
    return { content: `${report} in ${city}.` };
  },
});

// Render every event the loop emits, including the dimmed reasoning channel.
function render(e: AgentEvent) {
  switch (e.type) {
    case AgentEventType.ReasoningDelta:
      process.stdout.write(`\x1b[2m${e.text}\x1b[22m`);
      break;
    case AgentEventType.TextDelta:
      process.stdout.write(e.text);
      break;
    case AgentEventType.ToolStart:
      console.log(`→ ${e.toolName}(${JSON.stringify(e.args)})`);
      break;
    case AgentEventType.ToolEnd:
      console.log(`← ${e.toolName} [${e.isError ? "error" : "ok"}]: ${e.result}`);
      break;
  }
}

// Multi-turn: one memory + one sessionId, reused every turn.
const memory = new SessionMemoryStore();
const sessionId = "tool-tutorial";
const rl = createInterface({ input, output });

while (true) {
  const prompt = (await rl.question("\nyou › ")).trim();
  if (prompt === "" || prompt === "exit") break;

  process.stdout.write("bot › ");
  await runAgent({
    model,
    memory,
    sessionId,
    prompt,
    tools: [weather],
    onEvent: render,
  });
}
rl.close();
// #endregion
