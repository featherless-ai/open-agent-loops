/**
 * Code-execution tutorial — Step 4: gate it behind approval.
 *
 * Step 3 left the Deno sandbox for an unsandboxed Bun backend — so now a human
 * should sign off before any snippet runs. The `gateToolCalls` hook sees the
 * turn's calls before any execute and decides allow / deny / ask; here it ASKS
 * before every `code_execution`. With the deny-by-default Deno backend you often
 * don't need this — the sandbox is already the guardrail — but the moment you run
 * model-written code with real access, gate it. New lines are highlighted in the docs.
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/code-execution-tutorial/step4.ts
 *   you › what is 25 factorial? compute it by running code.
 *   🔐 allow code_execution(...)? [y/N]
 */
// #region step4
import {
  AgentEventType,
  ApprovalChoice, // [!code highlight]
  codeExecutionTool,
  InMemoryPermissionStore, // [!code highlight]
  permissionGate, // [!code highlight]
  PermissionPolicy, // [!code highlight]
  runAgent,
  SessionMemoryStore,
} from "../../agent-core/index.ts";
import type { AgentEvent, ApprovalPrompter, CodeExecutionBackend } from "../../agent-core/index.ts"; // [!code highlight]
import { OpenAICompatibleModel } from "../../agent-core/providers/openai-compatible.ts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  console.error("Set LLM_API_KEY (see .env.example).");
  process.exit(1);
}

// DeepSeek V4 tool-calls cleanly — it keeps the `code` string intact.
const model = new OpenAICompatibleModel({
  apiKey,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
  model: process.env.LLM_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash",
  thinking: "on",
});

// An unsandboxed Bun backend (from Step 3): runs the snippet with full host access.
const bunBackend: CodeExecutionBackend = {
  async exec(request, ctx) {
    const lang = request.language.toLowerCase();
    if (!["javascript", "js", "typescript", "ts"].includes(lang)) {
      throw new Error(`This backend runs JavaScript/TypeScript only; got "${request.language}".`);
    }
    const ext = lang === "ts" || lang === "typescript" ? "ts" : "js";
    const file = join(tmpdir(), `snippet-${crypto.randomUUID()}.${ext}`);
    await Bun.write(file, request.code);
    try {
      const proc = Bun.spawn(["bun", "run", file], { stdout: "pipe", stderr: "pipe", signal: ctx.signal });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, exitCode };
    } finally {
      await unlink(file).catch(() => {});
    }
  },
};
const codeExecution = codeExecutionTool(bunBackend);

const system = [
  "You are a coding agent. When a question needs computation, write a short",
  "snippet and run it with the `code_execution` tool instead of doing the math",
  "in your head. This backend runs JavaScript or TypeScript — use console.log to",
  "print the result so it comes back to you.",
].join("\n");

// Render every event the loop emits. ToolStart shows the code the model wrote;
// ToolEnd shows what the backend sent back (stdout + the always-present verdict).
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
      console.log(`← ${e.toolName} [${e.isError ? "error" : "ok"}]:\n${e.result}`);
      break;
  }
}

// Multi-turn: one memory + one sessionId, reused every turn.
const memory = new SessionMemoryStore();
const sessionId = "code-execution-tutorial";
const rl = createInterface({ input, output });

// Ask before any code runs: fallback is Ask, so every `code_execution` prompts. // [!code highlight:13]
const permissions = new InMemoryPermissionStore({ fallback: PermissionPolicy.Ask });
// A terminal prompter: show the call (name + args) and ask y/N.
const prompter: ApprovalPrompter = {
  async ask(batch) {
    const choices: ApprovalChoice[] = [];
    for (const { toolCall, args } of batch) {
      const answer = await rl.question(`\n🔐 allow ${toolCall.function.name}(${JSON.stringify(args)})? [y/N] `);
      choices.push(answer.trim().toLowerCase() === "y" ? ApprovalChoice.AllowOnce : ApprovalChoice.DenyOnce);
    }
    return choices;
  },
};
const gate = permissionGate(permissions, prompter);

while (true) {
  const prompt = (await rl.question("\nyou › ")).trim();
  if (prompt === "" || prompt === "exit") break;

  process.stdout.write("bot › ");
  await runAgent({
    model,
    memory,
    sessionId,
    prompt,
    system,
    tools: [codeExecution],
    hooks: { gateToolCalls: gate }, // [!code highlight]
    onEvent: render,
  });
}
rl.close();
// #endregion
