/**
 * Skills tutorial — Step 1: a skill the model loads on demand.
 *
 * One growing program, built up across examples/skill-tutorial/step1..4.ts — each
 * step is the previous file plus a few lines (highlighted in the docs). Here: a
 * `greet` skill that drives a shared `shell` tool, in a multi-turn chat loop.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/skill-tutorial/step1.ts
 *   you › say hello to Ada
 */
// #region step1
import {
  AgentEventType,
  runAgent,
  SessionMemoryStore,
  shellTool,
  SkillRegistry,
  skillTool,
} from "../../agent-loop-core/index.ts";
import type { AgentEvent, Skill } from "../../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
import { bunShellBackend } from "../../bun-backends.ts";
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

// One shared shell tool the skill drives.
const shell = shellTool(bunShellBackend());

// A skill is pure instructions here: it tells the model how to use `shell`.
const greetSkill: Skill = {
  name: "greet",
  description: "Greet a person by name.",
  instructions: [
    "To greet <name>, run the shell command:",
    '  echo "Hello, <name>!"',
    "Then report the output verbatim.",
  ].join("\n"),
};

const skills = new SkillRegistry([greetSkill]);

// The cheap catalog goes in the system prompt; the instructions stay out of it.
const system = [
  "You are a friendly assistant.",
  "",
  "## Available skills",
  skills.catalog(),
  "",
  "Call the `skill` tool with a skill name to load its instructions before using it.",
].join("\n");

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
const sessionId = "skill-tutorial";
const rl = createInterface({ input, output });

while (true) {
  const prompt = (await rl.question("\nyou › ")).trim();
  if (prompt === "" || prompt === "exit") break;

  process.stdout.write("bot › ");
  await runAgent({
    model,
    memory,
    sessionId,
    system,
    prompt,
    tools: [skillTool(skills), shell],
    onEvent: render,
  });
}
rl.close();
// #endregion
