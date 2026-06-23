/**
 * Agent-as-tool tutorial — Step 4: watch the sub-agents work.
 *
 * Step 3 plus visibility into each sub-agent. A sub-agent emits its own event
 * stream; hand it an `onEvent` and you can render it — attributed by name. The
 * lead's stream stays at the top level (`→`/`←`); each specialist's thinking and
 * tool calls show indented under its name. New lines are highlighted; this is the
 * finished program.
 *
 * Note: events don't yet carry an agent identity of their own — attribution here
 * is just the closure knowing which sub-agent it wrapped. A first-class
 * `agentId`/`agentName` on the event is the next step toward a single-chat UI.
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/agent-as-tool-tutorial/step4.ts
 *   you › where does the agent loop live and when does it stop?
 */
// #region step4
import {
  agentAsTool,
  AgentEventType,
  runAgent,
  SessionMemoryStore,
  shellTool,
} from "../../agent-core/index.ts";
import type { AgentEvent } from "../../agent-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-core/providers/openai-compatible.ts";
import { bunShellBackend } from "../../bun-backends.ts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname } from "node:path";
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

// Run the researcher's shell in this tutorial's folder, where team-notes.md lives.
const here = dirname(fileURLToPath(import.meta.url));

// Render a sub-agent's own event stream, indented and attributed by name. The     // [!code highlight:21]
// closure is what supplies the identity — the event itself doesn't carry one yet.
function subRender(name: string) {
  return (e: AgentEvent) => {
    switch (e.type) {
      case AgentEventType.AgentStart:
        process.stdout.write(`\n\x1b[2m  ┌─ ${name}\x1b[22m\n`);
        break;
      case AgentEventType.ReasoningDelta:
      case AgentEventType.TextDelta:
        process.stdout.write(`\x1b[2m${e.text}\x1b[22m`);
        break;
      case AgentEventType.ToolStart:
        process.stdout.write(`\n\x1b[2m  · ${name} → ${e.toolName}(${JSON.stringify(e.args)})\x1b[22m\n`);
        break;
      case AgentEventType.AgentEnd:
        process.stdout.write(`\n\x1b[2m  └─ ${name} done (${e.steps} steps)\x1b[22m\n`);
        break;
    }
  };
}

// The researcher now drives a `shell` tool over the team's knowledge base. The
// grep/cat churn happens inside its own session; only the finding comes back.
const researcher = agentAsTool({
  name: "researcher",
  description: "Researches a question against the team's notes and reports findings.",
  model,
  system:
    "You are a meticulous researcher. The team's knowledge base is in `team-notes.md`. " +
    "Use the shell (grep/cat) to read it, then report only the relevant findings.",
  tools: [shellTool(bunShellBackend({ cwd: here }))],
  onEvent: subRender("researcher"), // [!code highlight]
});

// A second specialist. Each sub-agent is just another agent with its own role —
// you could even give it a different model. The lead picks who to call.
const editor = agentAsTool({
  name: "editor",
  description: "Rewrites rough notes into a clear, well-structured answer.",
  model,
  system:
    "You are a sharp editor. Turn the given notes into a clear, concise answer. Do not invent facts.",
  onEvent: subRender("editor"), // [!code highlight]
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
