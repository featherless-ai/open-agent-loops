/**
 * Tracing tutorial — Step 2: capture the request wire.
 *
 * Step 1 recorded the loop's events — enough for the folded trajectory, but not
 * the actual bytes sent to the model. Here we add the request-side tap:
 * `onRawRequest` captures the fully assembled body (messages with the full
 * tool-call history, tools, sampling params), and `onRequest` seeds the model id
 * + baseURL into `tracer.meta`. At the end of each turn we report what landed.
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/tracing-tutorial/step2.ts
 *   you › what's the weather in Paris and Tokyo?
 */
// #region step2
import { AgentEventType, defineTool, runAgent, SessionMemoryStore, Tracer } from "../../agent-core/index.ts";
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

// The request-side taps. `onRawRequest` is the twin of `onRawSSE`: it hands over
// the exact JSON the SDK POSTs, once per model turn. `onRequest` is a lightweight
// summary — here it seeds the model id and baseURL into `tracer.meta`.
const model = new OpenAICompatibleModel({
  apiKey,
  model: modelId,
  baseURL,
  thinking: "on",
  onRawRequest: tracer.onRawRequest, // [!code highlight:2]
  onRequest: tracer.onRequest, //       model + baseURL → tracer.meta
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

  const before = tracer.entries.length; // remember where this turn starts // [!code highlight]
  process.stdout.write("bot › ");
  await runAgent({ model, memory, sessionId, prompt, tools: [weather], onEvent: observe });

  // End of turn: a `request_body` entry per model turn — the raw wire, with the // [!code highlight:4]
  // full tool-call history. One user message can be several model turns.
  const requests = tracer.entries.slice(before).filter((e) => e.label === "request_body");
  const last = requests.at(-1)?.data as { body?: { messages?: unknown[] } } | undefined;
  console.log(`\n# ${requests.length} request(s) captured · ${last?.body?.messages?.length ?? 0} messages`);
}
rl.close();
// #endregion
