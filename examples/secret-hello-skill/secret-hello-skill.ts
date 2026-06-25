/**
 * Runnable example: a credential-gated *binary* skill, in a multi-turn chat.
 *
 * Builds directly on `examples/multi-turn-chat` — the same read-input loop over
 * one reused `memory` + `sessionId`, so the conversation remembers itself. What
 * is new is the skill:
 *
 *   - a skill that is pure instructions (no tools of its own), telling the model
 *     to drive the shared `shell` tool;
 *   - the `shell` tool wrapped with `withCredentials`, so a `{{secret_hello_token}}`
 *     placeholder in a command is swapped for the real secret at execution time
 *     and scrubbed back out of the result;
 *   - a real binary, `../bin/secret-hello`, that refuses to run without the right
 *     credential — proof the secret is doing real work.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/secret-hello-skill/secret-hello-skill.ts
 *   you › say hi to Ada
 */

import {
  AgentEventType,
  InMemoryCredentialStore,
  runAgent,
  SessionMemoryStore,
  shellTool,
  SkillRegistry,
  skillTool,
  withCredentials,
} from "../../agent-loop-core/index.ts";
import type { AgentEvent, Skill } from "../../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
import { bunShellBackend } from "../../bun-backends.ts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The binary lives next door in examples/bin; run shell commands from there so
// the skill can call `./secret-hello`.
const binDir = join(dirname(fileURLToPath(import.meta.url)), "../bin");

// The credential the binary demands. In real life this comes from a vault; here
// it is seeded from the environment (or the known demo key) at startup. The
// model only ever sees the placeholder name, never this value.
const credentials = new InMemoryCredentialStore({
  secrets: { secret_hello_token: process.env.SECRET_HELLO_KEY ?? "s3cr3t-hello-key" },
});

// The shared shell tool, wrapped so {{secret_hello_token}} is resolved for the
// one command that uses it and scrubbed from whatever comes back.
const shell = withCredentials(shellTool(bunShellBackend({ cwd: binDir })), credentials);

// The skill: pure instructions that drive the shared shell tool. It ships no
// tools of its own — the typical skill shape.
const secretHelloSkill: Skill = {
  name: "secret-hello",
  description: "Greet a person using the access-controlled secret-hello CLI.",
  instructions: [
    "Greet a person with the secret-hello CLI, which requires a credential.",
    "",
    "To greet <name>, run exactly this shell command:",
    '  SECRET_HELLO_TOKEN={{secret_hello_token}} ./secret-hello "<name>"',
    "",
    "The {{secret_hello_token}} placeholder is filled in for you at run time —",
    "never ask the user for it and never print it. Report the greeting verbatim.",
  ].join("\n"),
};

const skills = new SkillRegistry([secretHelloSkill]);

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

// Render every event the loop emits — identical to the multi-turn chat loop,
// including the dimmed reasoning (thinking) channel.
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

// The system prompt carries the cheap half — the catalog. The instructions stay
// out of it; the model pulls those in by calling `skill`.
const system = [
  "You are a friendly assistant.",
  "",
  "## Available skills",
  skills.catalog(),
  "",
  "Call the `skill` tool with a skill name to load its instructions before using it.",
].join("\n");

// Multi-turn: one memory + one sessionId, reused every turn (see multi-turn-chat).
const memory = new SessionMemoryStore();
const sessionId = "secret-hello-chat";
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
