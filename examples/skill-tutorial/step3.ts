/**
 * Skills tutorial — Step 3: give the skill a secret.
 *
 * Step 2 plus a credential: the `greet` skill now delivers greetings through the
 * access-controlled `secret-hello` CLI, which needs a token the model never sees.
 * The shared `shell` is wrapped with `withCredentials`; new lines are highlighted.
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/skill-tutorial/step3.ts
 *   you › say hi to Ada
 */
// #region step3
import {
  AgentEventType,
  InMemoryCredentialStore, // [!code highlight]
  runAgent,
  SessionMemoryStore,
  shellTool,
  SkillRegistry,
  skillResourceTool,
  skillTool,
  withCredentials, // [!code highlight]
} from "../../agent-loop-core/index.ts";
import type { AgentEvent, Skill } from "../../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
import { bunShellBackend } from "../../bun-backends.ts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

const here = dirname(fileURLToPath(import.meta.url));
const binDir = join(here, "../bin"); // [!code highlight]

// The secret lives in a store; the model only ever sees the placeholder name.
const credentials = new InMemoryCredentialStore({ // [!code highlight:3]
  secrets: { secret_hello_token: process.env.SECRET_HELLO_KEY ?? "s3cr3t-hello-key" },
});

// Wrap the shared shell so {{secret_hello_token}} is filled in for the one command
// that uses it, and scrubbed back out of the result.
const shell = withCredentials(shellTool(bunShellBackend({ cwd: binDir })), credentials); // [!code highlight]

// A skill is pure instructions here: it tells the model how to use `shell`.
const greetSkill: Skill = {
  name: "greet",
  description: "Greet a person by name.",
  instructions: [
    "To greet <name>, run the access-controlled CLI:", // [!code highlight]
    '  SECRET_HELLO_TOKEN={{secret_hello_token}} ./secret-hello "<name>"', // [!code highlight]
    "For another language, first load the `phrasebook` resource.",
    "Never print the token. Report the greeting verbatim.", // [!code highlight]
  ].join("\n"),
  resources: {
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
    tools: [skillTool(skills), skillResourceTool(skills), shell],
    onEvent: render,
  });
}
rl.close();
// #endregion
