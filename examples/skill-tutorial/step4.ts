/**
 * Skills tutorial — Step 4: require approval before the skill acts.
 *
 * Step 3 plus a permission gate: `permissionGate` asks before any shell command
 * runs (loading a skill or a resource is pre-approved). The gate runs BEFORE the
 * credential swap, so the prompt shows the placeholder, never the secret. New
 * lines are highlighted; this is the finished program.
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/skill-tutorial/step4.ts
 *   you › say hi to Ada
 */
// #region step4
import {
  AgentEventType,
  ApprovalChoice, // [!code highlight]
  InMemoryCredentialStore,
  InMemoryPermissionStore, // [!code highlight]
  permissionGate, // [!code highlight]
  PermissionPolicy, // [!code highlight]
  runAgent,
  SessionMemoryStore,
  shellTool,
  SkillRegistry,
  skillResourceTool,
  skillTool,
  withCredentials,
} from "../../agent-loop-core/index.ts";
import type { AgentEvent, ApprovalPrompter, Skill } from "../../agent-loop-core/index.ts"; // [!code highlight]
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
import { bunShellBackend } from "../../backends/bun-backends.ts";
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
const binDir = join(here, "../bin");

// The secret lives in a store; the model only ever sees the placeholder name.
const credentials = new InMemoryCredentialStore({
  secrets: { secret_hello_token: process.env.SECRET_HELLO_KEY ?? "s3cr3t-hello-key" },
});

// Wrap the shared shell so {{secret_hello_token}} is filled in for the one command
// that uses it, and scrubbed back out of the result.
const shell = withCredentials(shellTool(bunShellBackend({ cwd: binDir })), credentials);

// A skill is pure instructions here: it tells the model how to use `shell`.
const greetSkill: Skill = {
  name: "greet",
  description: "Greet a person by name.",
  instructions: [
    "To greet <name>, run the access-controlled CLI:",
    '  SECRET_HELLO_TOKEN={{secret_hello_token}} ./secret-hello "<name>"',
    "For another language, first load the `phrasebook` resource.",
    "Never print the token. Report the greeting verbatim.",
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

// Pre-approve loading a skill or a resource; ask before any shell command runs. // [!code highlight:5]
const permissions = new InMemoryPermissionStore({
  fallback: PermissionPolicy.Ask,
  rules: { skill: PermissionPolicy.Allow, skill_resource: PermissionPolicy.Allow },
});
// A terminal prompter — it shows the args verbatim, which for a credentialed     // [!code highlight:12]
// command is the PLACEHOLDER, never the secret (the swap happens after approval).
const prompter: ApprovalPrompter = {
  async ask(batch) {
    const choices: ApprovalChoice[] = [];
    for (const { toolCall } of batch) {
      const ok = (await rl.question(`\n🔐 allow ${toolCall.function.name}? [y/N] `)).trim().toLowerCase() === "y";
      choices.push(ok ? ApprovalChoice.AllowOnce : ApprovalChoice.DenyOnce);
    }
    return choices;
  },
};
const gate = permissionGate(permissions, prompter); // [!code highlight]

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
    hooks: { gateToolCalls: gate }, // [!code highlight]
    onEvent: render,
  });
}
rl.close();
// #endregion
