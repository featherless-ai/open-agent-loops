/**
 * Code-execution tutorial — Step 2: grant the sandbox one capability.
 *
 * Step 1 plus a single permission grant. The Deno backend is deny-by-default — a
 * snippet can compute but can't touch your disk, network, or env. Here we grant
 * READ access to just the tutorial folder, so the model can read `data.txt` and
 * compute over it. Everything else stays denied. New lines are highlighted in the docs.
 *
 * Requires the `deno` binary on PATH (https://deno.com).
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/code-execution-tutorial/step2.ts
 *   you › add up the numbers in examples/code-execution-tutorial/data.txt
 */
// #region step2
import {
  AgentEventType,
  codeExecutionTool,
  runAgent,
  SessionMemoryStore,
} from "../../agent-loop-core/index.ts";
import type { AgentEvent } from "../../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
import { denoCodeExecutionBackend } from "../../backends/deno-backends.ts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  console.error("Set LLM_API_KEY (see .env.example).");
  process.exit(1);
}

// DeepSeek V4 tool-calls cleanly — it keeps the `code` string intact.
const model = new OpenAICompatibleModel({
  apiKey,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
  model: process.env.LLM_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash",
  thinking: "on",
});

// Still deny-by-default — now with ONE capability granted: the snippet may READ // [!code highlight:6]
// files under the tutorial folder, and nothing else (no write, network, or env).
// A path-scoped grant; pass `read: true` to allow all reads, or grant `net`/`write`/`env`.
const codeExecution = codeExecutionTool(
  denoCodeExecutionBackend({ allow: { read: ["examples/code-execution-tutorial"] } }),
);

// Steer the model to the tool and the sandbox's one constraint: print the result,
// and write JavaScript or TypeScript (the Deno backend rejects other languages).
const system = [
  "You are a coding agent. When a question needs computation, write a short",
  "snippet and run it with the `code_execution` tool instead of doing the math",
  "in your head. The sandbox runs JavaScript or TypeScript — use console.log to",
  "print the result so it comes back to you.",
  "You may read files under examples/code-execution-tutorial/, such as data.txt.", // [!code highlight]
].join("\n");

// Render every event the loop emits. ToolStart shows the code the model wrote;
// ToolEnd shows what the sandbox sent back (stdout + the always-present verdict).
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
      console.log(`← ${e.toolName} [${e.isError ? "error" : "ok"}]:\n${e.result}`);
      break;
  }
}

// Multi-turn: one memory + one sessionId, reused every turn.
const memory = new SessionMemoryStore();
const sessionId = "code-execution-tutorial";
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
    system,
    tools: [codeExecution],
    onEvent: render,
  });
}
rl.close();
// #endregion
