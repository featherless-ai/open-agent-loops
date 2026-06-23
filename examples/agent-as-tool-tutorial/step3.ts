/**
 * Agent-as-tool tutorial — Step 3: give a sub-agent its own tools.
 *
 * Step 2 plus a `shell` tool for the `researcher`, pointed at a local knowledge
 * base (`team-notes.md`). The researcher now does real work — grepping the file
 * across several turns — but all that churn stays in ITS session. The lead and
 * the transcript only ever see the distilled finding. That isolation is the whole
 * point of agent-as-tool. New lines are highlighted.
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/agent-as-tool-tutorial/step3.ts
 *   you › where does the agent loop live and when does it stop?
 */
// #region step3
import {
  agentAsTool,
  AgentEventType,
  runAgent,
  SessionMemoryStore,
  shellTool, // [!code highlight]
} from "../../agent-core/index.ts";
import type { AgentEvent } from "../../agent-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-core/providers/openai-compatible.ts";
import { bunShellBackend } from "../../bun-backends.ts"; // [!code highlight]
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname } from "node:path"; // [!code highlight:2]
import { fileURLToPath } from "node:url";

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

// Run the researcher's shell in this tutorial's folder, where team-notes.md lives. // [!code highlight:2]
const here = dirname(fileURLToPath(import.meta.url));

// The researcher now drives a `shell` tool over the team's knowledge base. The     // [!code highlight:9]
// grep/cat churn happens inside its own session; only the finding comes back.
const researcher = agentAsTool({
  name: "researcher",
  description: "Researches a question against the team's notes and reports findings.",
  model,
  system:
    "You are a meticulous researcher. The team's knowledge base is in `team-notes.md`. " +
    "Use the shell (grep/cat) to read it, then report only the relevant findings.",
  tools: [shellTool(bunShellBackend({ cwd: here }))],
});

// A second specialist. Each sub-agent is just another agent with its own role —
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
  "First call `researcher` to gather facts, then pass its notes to `editor` to",
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
    tools: [researcher, editor],
    onEvent: render,
  });
}
rl.close();
// #endregion
