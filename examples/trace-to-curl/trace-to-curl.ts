/**
 * Trace → curl: reproduce any model call the agent made.
 *
 * The `Tracer` taps both directions of the wire. The request side is
 * `onRawRequest`: it captures the exact body the SDK POSTs each turn — model,
 * `messages` (system folded in, every assistant `tool_calls` block and `tool`
 * result), `tools`, and sampling params. With `meta.baseURL` (from `onRequest`)
 * that's everything needed to rebuild a runnable `curl` — the API key stays a
 * `$LLM_API_KEY` placeholder, never captured.
 *
 * This runs a one-shot agent with a `weather` tool (so the trace has a real
 * tool-call history), then prints a curl for every turn. Paste any of them to
 * replay that exact call against the endpoint.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/trace-to-curl/trace-to-curl.ts
 */
import { AgentEventType, runAgent, SessionMemoryStore, toCurl, Tracer, defineTool } from "../../agent-core/index.ts";
import type { AgentEvent } from "../../agent-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-core/providers/openai-compatible.ts";
import { color } from "../console-format.ts";
import { z } from "zod";

const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  console.error("Set LLM_API_KEY (see .env.example).");
  process.exit(1);
}

const baseURL = process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1";

// The tracer is a passive observer; it never changes the run. Here we wire the
// request-side taps: onRawRequest (the full wire body) and onRequest (the model
// id + baseURL into meta, so the request URL is reconstructable).
const tracer = new Tracer();

const model = new OpenAICompatibleModel({
  apiKey,
  baseURL,
  model: process.env.LLM_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash",
  thinking: "on",
  onRawRequest: tracer.onRawRequest, // request wire  → captured per turn
  onRequest: tracer.onRequest, //       run config   → meta (model, baseURL)
});

const weather = defineTool({
  name: "weather",
  description: "Get the current weather for a city.",
  parameters: z.object({ city: z.string().describe('City to look up, e.g. "Paris".') }),
  execute: async ({ city }) => ({ content: `Sunny, 21°C in ${city}.` }),
});

// Render the run so you can see the tool calls happen before the curls print.
function render(e: AgentEvent) {
  switch (e.type) {
    case AgentEventType.ReasoningDelta:
      process.stdout.write(color("\x1b[2m", e.text));
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

process.stdout.write("bot › ");
await runAgent({
  model,
  memory: new SessionMemoryStore(),
  sessionId: "trace-to-curl",
  prompt: "What's the weather in Paris and Tokyo?",
  tools: [weather],
  onEvent: tracer.sink, // so the run also lands in the trace (agent_start → meta)
});

// Every turn's request body is now in the trace. Each later turn's body carries
// the growing tool-call history, so its curl replays exactly what the model saw.
const requests = tracer.entries.filter((e) => e.source === "model" && e.label === "request_body");

console.log(`\n\n${color("\x1b[1m", `${requests.length} request(s) captured`)} — replay any of them:\n`);
requests.forEach((entry, i) => {
  const body = (entry.data as { body: unknown }).body;
  const msgs = (body as { messages?: unknown[] }).messages?.length ?? 0;
  console.log(color("\x1b[36m", `# turn ${i + 1} — ${msgs} messages`));
  console.log(toCurl(body, { baseURL: tracer.meta.baseURL ?? baseURL, apiKeyEnv: "LLM_API_KEY", stream: false }));
  console.log();
});
