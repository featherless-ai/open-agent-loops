/**
 * Tools tutorial — Step 4: reach for a built-in tool over a backend.
 *
 * Step 3 plus the SDK's built-in `shell` tool. The SDK owns the model-facing
 * contract (name, schema, formatting); you supply the backend that actually runs
 * the command. The new lines are highlighted in the docs.
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/tool-tutorial/step4.ts
 *   you › list the files in the current directory
 */
// #region step4
import {
  AgentEventType,
  defineTool,
  ExecutionMode,
  runAgent,
  SessionMemoryStore,
  shellTool, // [!code highlight]
  ToolRegistry,
} from "../../agent-loop-core/index.ts";
import type { AgentEvent } from "../../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
import { bunShellBackend } from "../../bun-backends.ts"; // [!code highlight]
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

// A built-in tool: the SDK ships the `shell` contract; you bring the backend // [!code highlight:3]
// that runs the command (here Bun's, host glue you provide).
const shell = shellTool(bunShellBackend());

const registry = new ToolRegistry([weather, remember, shell]); // [!code highlight]

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
    tools: registry.list(),
    onEvent: render,
  });
}
rl.close();
// #endregion
