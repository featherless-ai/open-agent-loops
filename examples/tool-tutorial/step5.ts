/**
 * Tools tutorial — Step 5: gate a risky tool behind approval.
 *
 * Step 4 plus a permission gate: the `gateToolCalls` hook sees the turn's calls
 * before any run and decides allow / deny / ask. Here `weather` and `remember`
 * run freely; `shell` asks first. New lines are highlighted in the docs.
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/tool-tutorial/step5.ts
 *   you › list the files in the current directory
 */
// #region step5
import {
  AgentEventType,
  ApprovalChoice, // [!code highlight]
  defineTool,
  ExecutionMode,
  InMemoryPermissionStore, // [!code highlight]
  permissionGate, // [!code highlight]
  PermissionPolicy, // [!code highlight]
  runAgent,
  SessionMemoryStore,
  shellTool,
  ToolRegistry,
} from "../../agent-loop-core/index.ts";
import type { AgentEvent, ApprovalPrompter } from "../../agent-loop-core/index.ts"; // [!code highlight]
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
import { bunShellBackend } from "../../bun-backends.ts";
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

// The SDK ships the `shell` contract; you bring the backend that runs the command.
const shell = shellTool(bunShellBackend());

const registry = new ToolRegistry([weather, remember, shell]);

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

// Pre-approve the read-only tools; ask before the shell runs anything. // [!code highlight:5]
const permissions = new InMemoryPermissionStore({
  fallback: PermissionPolicy.Ask,
  rules: { weather: PermissionPolicy.Allow, remember: PermissionPolicy.Allow },
});
// A terminal prompter: show the call (name + args) and ask y/N. // [!code highlight:11]
const prompter: ApprovalPrompter = {
  async ask(batch) {
    const choices: ApprovalChoice[] = [];
    for (const { toolCall, args } of batch) {
      const ok = (await rl.question(`\n🔐 allow ${toolCall.function.name}(${JSON.stringify(args)})? [y/N] `)).trim().toLowerCase() === "y";
      choices.push(ok ? ApprovalChoice.AllowOnce : ApprovalChoice.DenyOnce);
    }
    return choices;
  },
};
const gate = permissionGate(permissions, prompter); // [!code highlight]

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
    hooks: { gateToolCalls: gate }, // [!code highlight]
    onEvent: render,
  });
}
rl.close();
// #endregion
