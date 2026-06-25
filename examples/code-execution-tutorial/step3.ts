/**
 * Code-execution tutorial — Step 3: swap the backend.
 *
 * Step 2, but behind the SAME `codeExecutionTool` we drop in our OWN backend
 * instead of the shipped Deno one. Anything implementing `CodeExecutionBackend` —
 * one `exec` method returning { stdout, stderr, exitCode } — works. Here a
 * Bun-based runtime that writes the snippet to a temp file and runs it. The model,
 * the loop, and the result format never change; only WHERE the code runs does.
 *
 * NOTE: this backend has NO sandbox — Bun runs the snippet with full host access.
 * That is exactly what Step 4 puts a human in front of. New lines are highlighted
 * in the docs.
 *
 * Run it (Bun auto-loads .env; no `deno` needed for this step):
 *   bun run examples/code-execution-tutorial/step3.ts
 *   you › what is 25 factorial? compute it by running code.
 */
// #region step3
import {
  AgentEventType,
  codeExecutionTool,
  runAgent,
  SessionMemoryStore,
} from "../../agent-loop-core/index.ts";
import type { AgentEvent, CodeExecutionBackend } from "../../agent-loop-core/index.ts"; // [!code highlight]
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { tmpdir } from "node:os"; // [!code highlight:3]
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

// Your own backend: implement `CodeExecutionBackend` and it drops in behind the // [!code highlight:27]
// SAME `codeExecutionTool`. This one runs the snippet on Bun instead of Deno —
// write it to a temp file, `bun run` it, capture stdout/stderr/exit. A container
// or hosted-cloud backend slots in the same way; only the body of `exec` changes.
// WARNING: unlike the Deno sandbox, Bun runs with full host access — no isolation.
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
const codeExecution = codeExecutionTool(bunBackend); // [!code highlight]

// Steer the model to the tool and to print the result. (No language guard needed
// for the prompt — the backend itself rejects anything but JavaScript/TypeScript.)
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
    onEvent: render,
  });
}
rl.close();
// #endregion
