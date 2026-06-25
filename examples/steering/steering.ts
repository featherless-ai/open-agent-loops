/**
 * Runnable example: steering and follow-up against a real model.
 *
 * Steering and follow-up are two ways to feed messages into a run that is
 * *already in flight*:
 *   - steering   — redirect the agent mid-task; the message is injected after
 *                  the current tool batch, so the next turn sees it.
 *   - follow-up  — extend the run past its natural final answer; the message is
 *                  injected when the agent would otherwise stop.
 *
 * The loop never owns input — it only *pulls* at its boundaries via the
 * `drainSteering` / `drainFollowUp` hooks. The caller owns the queue and feeds
 * it from a *non-blocking* source. That last part is the whole point: an
 * `await rl.question(...)` loop is blocking and can't steer — it can't read input
 * while a run is underway. Here we attach a `'line'` listener that pushes typed
 * lines into a `MessageQueue` while `runAgent` runs concurrently.
 *
 * Try it: ask for something with a step ("research penguins, then summarize").
 * While the slow `research` tool is running (~3s, you'll see it start), type a
 * redirect and press enter — e.g. "actually, make it about otters". It's
 * injected as a steering turn after the current batch, and the trajectory print
 * at the end shows it folded in (`↪ steering: ...`).
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/steering/steering.ts
 */

import {
  AgentEventType,
  contentToText,
  defineTool,
  MessageQueue,
  runAgent,
  SessionMemoryStore,
  Tracer,
  userMessage,
} from "../../agent-loop-core/index.ts";
import type { AgentEvent } from "../../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { z } from "zod";

const apiKey = process.env.LLM_API_KEY;
const modelId = process.env.LLM_MODEL;
if (!apiKey || !modelId) {
  console.error("Set LLM_API_KEY and LLM_MODEL (see .env.example).");
  process.exit(1);
}

// A deliberately slow tool, so there's a window to type a redirect while it
// runs. A real tool would do I/O here; the sleep just widens the steering window.
const research = defineTool({
  name: "research",
  description: "Research a topic (slow).",
  parameters: z.object({ topic: z.string().describe("Topic to research.") }),
  execute: async ({ topic }) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return { content: `Notes on ${topic}: lorem ipsum.` };
  },
});

const model = new OpenAICompatibleModel({
  apiKey,
  model: modelId,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
  thinking: "on",
});

// Two caller-owned queues — pi's steeringMode/followUpMode is the queue's `mode`.
const steering = new MessageQueue(); // one-at-a-time by default
const followUp = new MessageQueue();

function render(e: AgentEvent) {
  switch (e.type) {
    case AgentEventType.TurnStart:
      console.log(`\n— turn ${e.step} —`);
      break;
    case AgentEventType.TextDelta:
      process.stdout.write(e.text);
      break;
    case AgentEventType.ToolStart:
      console.log(`→ ${e.toolName}(${JSON.stringify(e.args)})  …running, type a redirect now`);
      break;
    case AgentEventType.ToolEnd:
      console.log(`← ${e.toolName}: ${e.result}`);
      break;
    case AgentEventType.MessageInjected:
      console.log(`\n↪ injected (${e.origin}): ${contentToText(e.message.content)}`);
      break;
    case AgentEventType.AgentEnd:
      console.log(`\n■ done · ${e.steps} steps`);
      break;
  }
}

const rl = createInterface({ input, output });
const prompt = await rl.question("you › ");

// Non-blocking input: every line typed *while the run is in flight* becomes a
// steering message. This is the part a blocking `await rl.question` can't do.
rl.on("line", (line) => {
  const text = line.trim();
  if (text) steering.push(userMessage({ content: text }));
});

// A tracer so the run is one clean trace and the injected turns show up folded
// into the trajectory at the end.
const tracer = new Tracer();

const result = await runAgent({
  model,
  memory: new SessionMemoryStore(),
  sessionId: "steering-demo",
  prompt,
  tools: [research],
  hooks: {
    drainSteering: () => steering.drain(),
    drainFollowUp: () => followUp.drain(),
  },
  onEvent: (e) => {
    render(e);
    void tracer.sink(e);
  },
});
rl.close();

console.log(`\n${result.messages.at(-1)?.content}`);
console.log(`\n${"─".repeat(40)}\n${tracer.formatTrajectory()}`);
