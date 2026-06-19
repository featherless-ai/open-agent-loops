/**
 * Runnable example: a multi-turn chat where a skill drives the real shell, and
 * every shell call passes through BOTH guard seams at once —
 *
 *   - permissions: `permissionGate` asks you before any `shell` command runs
 *     (loading a skill is pre-approved, so only the actual command prompts);
 *   - credentials: the shell tool is `withCredentials`-wrapped, so a
 *     `{{secret_hello_token}}` placeholder is swapped for the real secret at
 *     execution time and scrubbed back out.
 *
 * The load-bearing detail: the gate runs *before* execution and the credential
 * swap happens *inside* it, so the approval prompt shows you the PLACEHOLDER —
 * never the real secret.
 *
 * Two skills, both pure instructions driving the shared shell (see
 * examples/multi-turn-chat for the loop, examples/secret-hello-skill for the
 * credentialed binary):
 *   - `hello`        → echoes a greeting (no credential)
 *   - `secret-hello` → runs the access-controlled ../bin/secret-hello binary
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/guarded-skill-chat/guarded-skill-chat.ts
 *   you › say hi to Ada
 *   you › now give Ada a secret hello
 */

import {
  AgentEventType,
  ApprovalChoice,
  InMemoryCredentialStore,
  InMemoryPermissionStore,
  permissionGate,
  PermissionPolicy,
  runAgent,
  SessionMemoryStore,
  shellTool,
  SkillRegistry,
  skillTool,
  withCredentials,
} from "../../agent-core/index.ts";
import type { AgentEvent, ApprovalPrompter, Skill } from "../../agent-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-core/providers/openai-compatible.ts";
import { bunShellBackend } from "../../bun-backends.ts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Dependencies — every piece the run needs, wired up front.
// ---------------------------------------------------------------------------

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

// The binary lives next door in examples/bin; run shell commands from there.
const binDir = join(dirname(fileURLToPath(import.meta.url)), "../bin");

// Credentials: the model only ever sees the placeholder name, never this value.
const credentials = new InMemoryCredentialStore({
  secrets: { secret_hello_token: process.env.SECRET_HELLO_KEY ?? "s3cr3t-hello-key" },
});

// One shared shell tool, credential-wrapped. {{secret_hello_token}} is resolved
// for the one command that uses it and scrubbed from the result.
const shell = withCredentials(shellTool(bunShellBackend({ cwd: binDir })), credentials);

// Two skills, both pure instructions driving the shared shell.
const helloSkill: Skill = {
  name: "hello",
  description: "Greet a person by name.",
  instructions: 'To greet <name>, run the shell command: echo "Hello, <name>!" — then report the output.',
};
const secretHelloSkill: Skill = {
  name: "secret-hello",
  description: "Greet a person using the access-controlled secret-hello CLI.",
  instructions: [
    "To greet <name>, run exactly this shell command:",
    '  SECRET_HELLO_TOKEN={{secret_hello_token}} ./secret-hello "<name>"',
    "The {{secret_hello_token}} placeholder is filled in at run time — never ask",
    "for it or print it. Report the greeting verbatim.",
  ].join("\n"),
};
const skills = new SkillRegistry([helloSkill, secretHelloSkill]);

// Permissions: prompt before any shell command; loading a skill never prompts.
const permissions = new InMemoryPermissionStore({
  fallback: PermissionPolicy.Ask,
  rules: { skill: PermissionPolicy.Allow },
});

const rl = createInterface({ input, output });

// A terminal prompter. It shows the args verbatim — which for a credentialed
// command is the PLACEHOLDER, not the secret (the swap happens after approval).
const prompter: ApprovalPrompter = {
  async ask(batch) {
    const choices: ApprovalChoice[] = [];
    for (const req of batch) {
      const answer = (
        await rl.question(
          `\n🔐 allow ${req.toolCall.function.name}(${JSON.stringify(req.args)})?` +
            ` [y]es once / [a]lways / [n]o / [d]eny always: `,
        )
      )
        .trim()
        .toLowerCase();
      choices.push(
        answer === "a"
          ? ApprovalChoice.AllowAlways
          : answer === "d"
            ? ApprovalChoice.DenyAlways
            : answer === "y"
              ? ApprovalChoice.AllowOnce
              : ApprovalChoice.DenyOnce, // anything else fails closed
      );
    }
    return choices;
  },
};

const gate = permissionGate(permissions, prompter);

const system = [
  "You are a friendly assistant.",
  "",
  "## Available skills",
  skills.catalog(),
  "",
  "Call the `skill` tool with a skill name to load its instructions before using it.",
].join("\n");

// ---------------------------------------------------------------------------
// Run — a multi-turn loop over one reused memory + sessionId.
// ---------------------------------------------------------------------------

// Render every event the loop emits — identical to the multi-turn chat loop,
// including the dimmed reasoning (thinking) channel. A denied call comes back as
// an error tool-result, so it shows as `[error]` here.
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
      console.log(`← ${e.toolName} [${e.isError ? "error" : "ok"}]: ${e.result}`);
      break;
    case AgentEventType.AgentEnd:
      console.log(`\n■ done · ${e.steps} steps`);
      break;
  }
}

const memory = new SessionMemoryStore();
const sessionId = "guarded-skill-chat";

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
    hooks: { gateToolCalls: gate }, // permissions
    onEvent: render,
  });
}
rl.close();
