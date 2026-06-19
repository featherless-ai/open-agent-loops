/**
 * Tools tutorial — Step 3: many tools, in a ToolRegistry.
 *
 * Step 2 plus a second, stateful `remember` tool and a `ToolRegistry` that holds
 * the catalog. Because `remember` mutates shared state, it runs Sequential so a
 * turn's calls can't interleave. The new lines are highlighted in the docs.
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/tool-tutorial/step3.ts
 *   you › remember to pack an umbrella, then check Tokyo's weather
 */
// #region step3
import {
  AgentEventType,
  defineTool,
  ExecutionMode, // [!code highlight]
  runAgent,
  SessionMemoryStore,
  ToolRegistry, // [!code highlight]
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
    const report = KNOWN[city];
    if (!report) {
      throw new Error(`No weather for "${city}". Known cities: ${Object.keys(KNOWN).join(", ")}.`);
    }
    return { content: `${report} in ${city}.` };
  },
});

// A stateful tool: it appends to a shared list. Mark it Sequential so several // [!code highlight:14]
// calls in one turn run one-at-a-time, never racing on `notes` — the same
// reason the planning tools run sequentially.
const notes: string[] = [];
const remember = defineTool({
  name: "remember",
  description: "Save a short note for later in the conversation.",
  parameters: z.object({ note: z.string().describe("The note to save.") }),
  execute: async ({ note }) => {
    notes.push(note);
    return { content: `Saved. ${notes.length} note(s) so far.` };
  },
  executionMode: ExecutionMode.Sequential,
});

// Build the catalog once; hand the loop the array the registry resolves. // [!code highlight:2]
const registry = new ToolRegistry([weather, remember]);

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
    tools: registry.list(), // [!code highlight]
    onEvent: render,
  });
}
rl.close();
// #endregion
