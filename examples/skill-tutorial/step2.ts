/**
 * Skills tutorial — Step 2: bundle reference material, loaded on demand.
 *
 * Step 1 plus a Level-3 resource: the `greet` skill carries a `phrasebook` file
 * it loads only when asked. The new lines are highlighted in the docs.
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/skill-tutorial/step2.ts
 *   you › say hello to Ada in French
 */
// #region step2
import {
  AgentEventType,
  runAgent,
  SessionMemoryStore,
  shellTool,
  SkillRegistry,
  skillResourceTool, // [!code highlight]
  skillTool,
} from "../../agent-loop-core/index.ts";
import type { AgentEvent, Skill } from "../../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
import { bunShellBackend } from "../../bun-backends.ts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFile } from "node:fs/promises"; // [!code highlight]
import { dirname, join } from "node:path"; // [!code highlight]
import { fileURLToPath } from "node:url"; // [!code highlight]

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

const here = dirname(fileURLToPath(import.meta.url)); // [!code highlight]

// A skill is pure instructions here: it tells the model how to use `shell`.
const greetSkill: Skill = {
  name: "greet",
  description: "Greet a person by name.",
  instructions: [
    "To greet <name>, run the shell command:",
    '  echo "Hello, <name>!"',
    "For another language, first load the `phrasebook` resource.", // [!code highlight]
    "Then report the output verbatim.",
  ].join("\n"),
  resources: { // [!code highlight:6]
    phrasebook: {
      description: "Hello in several languages.",
      load: () => readFile(join(here, "phrasebook.md"), "utf8"),
    },
  },
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
    tools: [skillTool(skills), skillResourceTool(skills), shell], // [!code highlight]
    onEvent: render,
  });
}
rl.close();
// #endregion
