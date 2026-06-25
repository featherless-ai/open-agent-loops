/**
 * Agent-as-tool tutorial — Step 1: wrap an agent as a tool another agent calls.
 *
 * One growing program, built up across examples/agent-as-tool-tutorial/step1..4.ts
 * — each step is the previous file plus a few lines (highlighted in the docs).
 * Here: an *orchestrator* loop (the "team lead") with one specialist sub-agent, a
 * `researcher`, exposed as a tool via `agentAsTool`. The lead delegates, the
 * sub-agent answers in its own isolated session, and only its finding comes back.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/agent-as-tool-tutorial/step1.ts
 *   you › what does the agent loop stop on?
 */
// #region step1
import {
  agentAsTool,
  AgentEventType,
  runAgent,
  SessionMemoryStore,
} from "../../agent-loop-core/index.ts";
import type { AgentEvent } from "../../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

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

// A specialist sub-agent, wrapped as a tool the orchestrator can call. By default
// each call runs in its OWN fresh session — the sub-agent burns its own context
// and only its final answer returns, so the lead's thread stays clean.
const researcher = agentAsTool({
  name: "researcher",
  description: "Researches a question and reports concise findings.",
  model,
  system: "You are a meticulous researcher. Answer the task directly and concisely.",
});

// The orchestrator's system prompt: it routes work to its specialists.
const system = [
  "You are the team lead. You coordinate specialists to answer the user.",
  "Delegate fact-finding to the `researcher` tool, then answer the user yourself.",
].join("\n");

// Render every event the loop emits, including the dimmed reasoning channel. The
// `→`/`←` lines show the lead calling the sub-agent and the finding it gets back.
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

// Multi-turn: one memory + one sessionId for the lead, reused every turn.
const memory = new SessionMemoryStore();
const sessionId = "agent-as-tool-tutorial";
const rl = createInterface({ input, output });

while (true) {
  const prompt = (await rl.question("\nyou › ")).trim();
  if (prompt === "" || prompt === "exit") break;

  process.stdout.write("lead › ");
  await runAgent({
    model,
    memory,
    sessionId,
    system,
    prompt,
    tools: [researcher],
    onEvent: render,
  });
}
rl.close();
// #endregion
