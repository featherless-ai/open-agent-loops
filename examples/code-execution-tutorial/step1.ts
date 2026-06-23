/**
 * Code-execution tutorial — Step 1: run a snippet in a sandbox.
 *
 * One growing program, built up across examples/code-execution-tutorial/step1..4.ts
 * — each step is the previous file plus a few lines (highlighted in the docs). Here:
 * the built-in `code_execution` tool over the sandboxed, deny-by-default Deno
 * backend, in a multi-turn chat loop. The model writes a snippet; your machine runs
 * it for REAL and the captured output comes back — measured, never invented.
 *
 * Requires the `deno` binary on PATH (https://deno.com) — the backend shells out to it.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/code-execution-tutorial/step1.ts
 *   you › what is the 20th Fibonacci number? compute it by running code.
 */
// #region step1
import {
  AgentEventType,
  codeExecutionTool,
  runAgent,
  SessionMemoryStore,
} from "../../agent-loop-core/index.ts";
import type { AgentEvent } from "../../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
import { denoCodeExecutionBackend } from "../../deno-backends.ts";
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

// `codeExecutionTool` is the stable, model-facing contract; the backend is the
// swappable host glue that actually runs the code. `denoCodeExecutionBackend()` is
// deny-by-default — the snippet gets NO file, network, or env access, so we can run
// untrusted, model-written code with no permission gate.
const codeExecution = codeExecutionTool(denoCodeExecutionBackend());

// Steer the model to the tool and the sandbox's one constraint: print the result,
// and write JavaScript or TypeScript (the Deno backend rejects other languages).
const system = [
  "You are a coding agent. When a question needs computation, write a short",
  "snippet and run it with the `code_execution` tool instead of doing the math",
  "in your head. The sandbox runs JavaScript or TypeScript — use console.log to",
  "print the result so it comes back to you.",
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
