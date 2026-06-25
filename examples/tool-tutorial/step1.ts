/**
 * Tools tutorial — Step 1: define a tool the model can call.
 *
 * One growing program, built up across examples/tool-tutorial/step1..4.ts — each
 * step is the previous file plus a few lines (highlighted in the docs). Here: a
 * single `weather` tool authored with `defineTool`, in a multi-turn chat loop.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/tool-tutorial/step1.ts
 *   you › what's the weather in Paris?
 */
// #region step1
import {
  AgentEventType,
  defineTool,
  runAgent,
  SessionMemoryStore,
} from "../../agent-loop-core/index.ts";
import type { AgentEvent } from "../../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
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

// A tool is a name, a description, a Zod schema, and an execute handler. `args`
// is inferred from the schema, so `{ city }` below is typed as a string — and
// the description plus each field's `.describe()` are all the model sees.
const weather = defineTool({
  name: "weather",
  description: "Get the current weather for a city.",
  parameters: z.object({
    city: z.string().describe('City to look up, e.g. "Paris".'),
  }),
  execute: async ({ city }) => {
    // Replace with a real API call. The returned `content` is folded back into
    // the conversation as this tool call's result.
    return { content: `Sunny, 21°C in ${city}.` };
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
