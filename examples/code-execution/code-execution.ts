/**
 * Runnable example: the built-in `code_execution` tool over a sandboxed Deno backend.
 *
 * Shows the full round trip — the model writes a snippet, your machine runs it for
 * real inside Deno's deny-by-default permission sandbox, and the captured
 * stdout/stderr plus an explicit exit verdict come back as the tool result (never
 * invented in the prompt). See README.md in this folder for the node diagram and
 * how to swap the backend for your own or a cloud variant.
 *
 * Requires the `deno` binary on PATH (https://deno.com) — the backend shells out to it.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/code-execution/code-execution.ts
 */

import {
  AgentEventType,
  codeExecutionTool,
  runAgent,
  SessionMemoryStore,
} from "../../agent-loop-core/index.ts";
import type { AgentEvent } from "../../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
import { denoCodeExecutionBackend } from "../../backends/deno-backends.ts";

// DeepSeek V4 for the demo: it tool-calls cleanly. (GLM emits broken empty-key
// tool args, which would mangle the `code` string this tool depends on.)
const model = new OpenAICompatibleModel({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
  model: process.env.LLM_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash",
  thinking: "on",
});

// The whole point of the seam: `codeExecutionTool` is the stable, model-facing
// contract; `denoCodeExecutionBackend()` is the swappable host glue that runs the
// code. Deny-by-default — the snippet gets NO file/network/env access here, so we
// can run untrusted, model-written code without a permission gate. Don't like how
// this runs? Replace it with your own CodeExecutionBackend (a container, a microVM)
// or a cloud variant — the tool, the loop, and the result format never change.
// See README.md.
const codeExecution = codeExecutionTool(denoCodeExecutionBackend());

// Render every event the loop emits. ToolStart shows the code the model wrote;
// ToolEnd shows what the sandbox sent back (stdout + the always-present verdict).
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
      console.log(`← ${e.toolName} [${e.isError ? "error" : "ok"}]:\n${e.result}`);
      break;
    case AgentEventType.AgentEnd:
      console.log(`\n■ done · ${e.steps} steps`);
      break;
  }
}

const result = await runAgent({
  model,
  memory: new SessionMemoryStore(),
  sessionId: "code-execution-demo",
  // Tell the model the tool exists and what the sandbox runs. The Deno backend is
  // JS/TS only, so steer it there — a Python snippet would be rejected (and retried).
  system: [
    "You are a coding agent. When a question needs computation, write a short",
    "snippet and run it with the `code_execution` tool instead of doing the math",
    "in your head. The sandbox runs JavaScript or TypeScript — use console.log to",
    "print the result so it comes back to you.",
  ].join("\n"),
  tools: [codeExecution],
  prompt: "What is the 20th Fibonacci number? Compute it by running code.",
  onEvent: render,
});

console.log(`\n${result.messages.at(-1)?.content}`);
