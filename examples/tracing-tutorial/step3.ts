/**
 * Tracing tutorial — Step 3: a replayable curl at the end of each turn.
 *
 * The trace already holds every request body. `tracer.curls()` renders each into
 * a runnable command — stitching in `meta.baseURL`, the API key kept as a
 * `$LLM_API_KEY` placeholder, never captured. (It's sugar over the `toCurl`
 * building block; reach for `toCurl` directly for a custom path or `-d @file`.)
 * At the end of each turn we print a curl for every request the turn made; paste
 * any to reproduce the exact call (tool-call history and all).
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/tracing-tutorial/step3.ts
 *   you › what's the weather in Paris and Tokyo?
 */
// #region step3
import { AgentEventType, defineTool, runAgent, SessionMemoryStore, Tracer } from "../../agent-core/index.ts"; // [!code highlight]
import type { AgentEvent } from "../../agent-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-core/providers/openai-compatible.ts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { z } from "zod";

const apiKey = process.env.LLM_API_KEY;
const modelId = process.env.LLM_MODEL;
if (!apiKey || !modelId) {
  console.error("Set LLM_API_KEY and LLM_MODEL (see .env.example).");
  process.exit(1);
}

const baseURL = process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1";

const weather = defineTool({
  name: "weather",
  description: "Get the current weather for a city.",
  parameters: z.object({ city: z.string().describe("City to look up.") }),
  execute: async ({ city }) => ({ content: `Sunny in ${city}` }),
});

const tracer = new Tracer();

const model = new OpenAICompatibleModel({
  apiKey,
  model: modelId,
  baseURL,
  thinking: "on",
  onRawRequest: tracer.onRawRequest,
  onRequest: tracer.onRequest,
});

function render(e: AgentEvent) {
  switch (e.type) {
    case AgentEventType.ReasoningDelta:
      process.stdout.write(`\x1b[2m${e.text}\x1b[22m`);
      break;
    case AgentEventType.TextDelta:
      process.stdout.write(e.text);
      break;
    case AgentEventType.ToolStart:
      console.log(`\n→ ${e.toolName}(${JSON.stringify(e.args)})`);
      break;
    case AgentEventType.ToolEnd:
      console.log(`← ${e.toolName} [${e.isError ? "error" : "ok"}]: ${e.result}`);
      break;
  }
}

const observe = (e: AgentEvent) => { render(e); tracer.sink(e); };

const memory = new SessionMemoryStore();
const sessionId = "tracing";
const rl = createInterface({ input, output });

while (true) {
  const prompt = (await rl.question("\nyou › ")).trim();
  if (prompt === "" || prompt === "exit") break;

  const before = tracer.requests().length;
  process.stdout.write("bot › ");
  await runAgent({ model, memory, sessionId, prompt, tools: [weather], onEvent: observe });

  // End of turn: `curls()` renders each captured body as a runnable curl. It owns // [!code highlight:8]
  // the wire plumbing — filtering the request bodies and stitching in
  // `meta.baseURL` — and keeps the key a `$LLM_API_KEY` placeholder (never
  // captured). `stream: false` gives a single readable JSON response on replay;
  // `slice(before)` keeps just this turn's. Paste any to reproduce that exact call.
  const curls = tracer.curls({ apiKeyEnv: "LLM_API_KEY", stream: false }).slice(before);
  console.log(`\n# ${curls.length} request(s) this turn — replay any of them:\n`);
  for (const curl of curls) {
    console.log(curl);
    console.log();
  }
}
rl.close();
// #endregion
