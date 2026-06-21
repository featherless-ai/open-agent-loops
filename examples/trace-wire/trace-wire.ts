/**
 * Trace → over-the-wire timeline: the raw bytes, both directions.
 *
 * `trace-timeline` shows the run at the AGENT grain — turns, messages, tool
 * calls, and the streamed reasoning/text deltas. Those deltas are the loop's
 * parse of the response, not the wire itself. This example drops to the lowest
 * grain, the raw HTTP exchange, by wiring both raw taps:
 *   - onRawRequest  the exact JSON body POSTed each turn   (request wire, out)
 *   - onRawSSE      every `data: {…}` line streamed back    (response wire, in)
 *
 * `format({ sources: ["model", "sse"] })` then renders just those two grains as
 * one ordered timeline: a `request_body` marker per turn, interleaved with the
 * raw SSE lines the server streamed. `format()` truncates long values, so the
 * exact request bytes are printed in full afterward from the captured bodies.
 *
 * Neither tap sees HTTP headers, so the API key is never captured.
 *
 * This runs a one-shot agent with a `weather` tool so the wire carries a real
 * tool-call exchange.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/trace-wire/trace-wire.ts
 */
import { AgentEventType, runAgent, SessionMemoryStore, Tracer, defineTool } from "../../agent-core/index.ts";
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

// Wire BOTH raw taps: the request body that goes out, and the raw SSE lines that
// come back. These are the literal bytes on the wire — the response wire is the
// SSE the framework parses into the deltas you see in trace-timeline.
const tracer = new Tracer();

const model = new OpenAICompatibleModel({
  apiKey,
  baseURL,
  model: process.env.LLM_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash",
  thinking: "on",
  onRawRequest: tracer.onRawRequest, // request wire (out) → exact body per turn
  onRawSSE: tracer.onRawSSE, //         response wire (in) → raw `data:` lines
  onRequest: tracer.onRequest, //       run config         → meta (model, baseURL)
});

const weather = defineTool({
  name: "weather",
  description: "Get the current weather for a city.",
  parameters: z.object({ city: z.string().describe('City to look up, e.g. "Paris".') }),
  execute: async ({ city }) => ({ content: `Sunny, 21°C in ${city}.` }),
});

// Render the run live; the tracer captures the wire alongside.
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

const observe = (e: AgentEvent) => { render(e); tracer.sink(e); };

process.stdout.write("bot › ");
await runAgent({
  model,
  memory: new SessionMemoryStore(),
  sessionId: "trace-wire",
  prompt: "What's the weather in Paris and Tokyo?",
  tools: [weather],
  onEvent: observe,
});

// The over-the-wire timeline: a request marker per turn interleaved with the raw
// SSE lines the server streamed back, in arrival order. Filtering to the wire
// grains drops the agent-grain deltas entirely.
console.log(`\n\n${color("\x1b[1m", "over-the-wire timeline")} (request + raw SSE):`);
console.log(tracer.format({ sources: ["model", "sse"], maxValueLength: 120 }));

// format() shows the request body compactly (`body msgs=N tools=M`); here are the
// exact bytes that went out each turn — the request side of the wire, in full.
const requests = tracer.entries.filter((e) => e.source === "model" && e.label === "request_body");
requests.forEach((entry, i) => {
  const body = (entry.data as { body: unknown }).body;
  console.log(`\n${color("\x1b[36m", `# turn ${i + 1} — request body (exact bytes, out)`)}`);
  console.log(JSON.stringify(body, null, 2));
});
