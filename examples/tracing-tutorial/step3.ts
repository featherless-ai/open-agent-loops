/**
 * Tracing tutorial — Step 3: a replayable curl at the end of each turn.
 *
 * The trace already holds every request body. `toCurl` stitches one of those
 * bodies together with `meta.baseURL` into a runnable command — the API key kept
 * as a `$LLM_API_KEY` placeholder, never captured. At the end of each turn we
 * print a curl for every request the turn made; paste any to reproduce the exact
 * call (tool-call history and all).
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/tracing-tutorial/step3.ts
 *   you › what's the weather in Paris and Tokyo?
 */
// #region step3
import { AgentEventType, defineTool, runAgent, SessionMemoryStore, toCurl, Tracer } from "../../agent-core/index.ts"; // [!code highlight]
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

  const before = tracer.entries.length;
  process.stdout.write("bot › ");
  await runAgent({ model, memory, sessionId, prompt, tools: [weather], onEvent: observe });

  // End of turn: turn each captured body into a runnable curl. The key stays a // [!code highlight:9]
  // `$LLM_API_KEY` placeholder (never captured); `stream: false` gives a single
  // readable JSON response on replay. Paste any to reproduce that exact call.
  const requests = tracer.entries.slice(before).filter((e) => e.label === "request_body");
  console.log(`\n# ${requests.length} request(s) this turn — replay any of them:\n`);
  for (const entry of requests) {
    const body = (entry.data as { body: unknown }).body;
    console.log(toCurl(body, { baseURL: tracer.meta.baseURL ?? baseURL, apiKeyEnv: "LLM_API_KEY", stream: false }));
    console.log();
  }
}
rl.close();
// #endregion
