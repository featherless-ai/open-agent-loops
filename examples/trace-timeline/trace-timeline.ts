/**
 * Trace → full timeline: every event the run produced, in one ordered list.
 *
 * The `Tracer` is a passive observer that rides the seams the loop already
 * exposes. Wire the request taps and the event sink and one run lands in a
 * single timeline:
 *   - tracer.sink            agent events  (turn / message / tool start+end)
 *   - onRawRequest           the request wire → exact body POSTed per turn
 *   - onRequest              run config → meta (model, baseURL, params, system)
 *
 * After the run, `format()` prints that whole timeline one entry per line — the
 * headline here — and `toJSONL()` writes the same entries to disk (one JSON
 * object per line) for tooling. `toJSON()` bundles the timeline with the run's
 * metadata as a single document.
 *
 * This runs a one-shot agent with a `weather` tool so the timeline has a real
 * tool-call history.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/trace-timeline/trace-timeline.ts
 */
import { AgentEventType, runAgent, SessionMemoryStore, Tracer, defineTool } from "../../agent-core/index.ts";
import type { AgentEvent } from "../../agent-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-core/providers/openai-compatible.ts";
import { color } from "../console-format.ts";
import { writeFile } from "node:fs/promises";
import { z } from "zod";

const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  console.error("Set LLM_API_KEY (see .env.example).");
  process.exit(1);
}

const baseURL = process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1";

// One passive Tracer. The sink captures the agent's events; the request taps
// add the exact wire body per turn and seed meta (model, baseURL). The run is
// never aware it's observed.
const tracer = new Tracer();

const model = new OpenAICompatibleModel({
  apiKey,
  baseURL,
  model: process.env.LLM_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash",
  thinking: "on",
  onRawRequest: tracer.onRawRequest, // request wire → exact body per turn
  onRequest: tracer.onRequest, //       run config  → meta (model, baseURL)
});

const weather = defineTool({
  name: "weather",
  description: "Get the current weather for a city.",
  parameters: z.object({ city: z.string().describe('City to look up, e.g. "Paris".') }),
  execute: async ({ city }) => ({ content: `Sunny, 21°C in ${city}.` }),
});

// Render the run live, the same as any chat loop — the tracer rides alongside.
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

// Fan each event to both: the renderer for the human, the sink for the record.
const observe = (e: AgentEvent) => { render(e); tracer.sink(e); };

process.stdout.write("bot › ");
await runAgent({
  model,
  memory: new SessionMemoryStore(),
  sessionId: "trace-timeline",
  prompt: "What's the weather in Paris and Tokyo?",
  tools: [weather],
  onEvent: observe,
});

// The full timeline — every captured entry, one per line, with +dt offsets and a
// metadata header (model, baseURL, system, tools). This is `format()`.
console.log(`\n\n${tracer.format()}`);

// The same entries scoped to one source — `format()` takes a `sources` filter so
// you can narrow a noisy timeline to just the grain you care about.
console.log(`\n${color("\x1b[1m", "agent events only")}:`);
console.log(tracer.format({ sources: ["agent"] }));

// The whole timeline as one JSON object per line — append-friendly, for storage
// or tooling. `toJSON()` instead bundles these entries with `meta` as one doc.
await writeFile("trace.jsonl", tracer.toJSONL());
console.log(`\n${color("\x1b[2m", `wrote ${tracer.entries.length} entries → trace.jsonl`)}`);
