/**
 * Agent-as-tool tutorial — Step 2: a second specialist, one chat.
 *
 * Step 1 plus an `editor` sub-agent. Now the lead *routes* between two
 * specialists over the same conversation: the `researcher` gathers rough notes,
 * the `editor` turns them into a clean answer. This is the "single chat, many
 * agents" shape — each specialist its own agent, all behind one thread. New lines
 * are highlighted.
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/agent-as-tool-tutorial/step2.ts
 *   you › explain how sub-agents stay isolated
 */
// #region step2
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

// A second specialist. Each sub-agent is just another agent with its own role —    // [!code highlight:8]
// you could even give it a different model. The lead picks who to call.
const editor = agentAsTool({
  name: "editor",
  description: "Rewrites rough notes into a clear, well-structured answer.",
  model,
  system:
    "You are a sharp editor. Turn the given notes into a clear, concise answer. Do not invent facts.",
});

// The orchestrator's system prompt: it routes work to its specialists.
const system = [
  "You are the team lead. You coordinate specialists to answer the user.",
  "First call `researcher` to gather facts, then pass its notes to `editor` to", // [!code highlight:2]
  "polish, then give the user the editor's version.",
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
    tools: [researcher, editor], // [!code highlight]
    onEvent: render,
  });
}
rl.close();
// #endregion
