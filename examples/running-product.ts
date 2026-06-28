/**
 * Runnable example: a tool-calling agent run against a real model.
 *
 * A deliberately long, sequential task: a running product over a list of random
 * numbers. Each multiplication depends on the previous result, so the agent
 * can't batch them — it makes its own sequence of shell calls, one step per
 * number, driving the loop toward `maxSteps`.
 *
 * Run it (LLM_API_KEY and LLM_MODEL come from `.env`):
 *   bun run examples/running-product.ts
 */

import {
  AgentEventType,
  runAgent,
  searchTool,
  SessionMemoryStore,
  shellTool,
} from "../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../agent-loop-core/providers/openai-compatible.ts";
import { bunSearchBackend, bunShellBackend } from "../backends/bun-backends.ts";
import { ANSI, color } from "./console-format.ts";

const FACTOR_COUNT = 12;
const FACTORS = Array.from({ length: FACTOR_COUNT }, () => 2 + Math.floor(Math.random() * 98));

const apiKey = process.env.LLM_API_KEY;
const model = process.env.LLM_MODEL;
if (!apiKey || !model) {
  console.error("Set LLM_API_KEY and LLM_MODEL (see .env.example).");
  process.exit(1);
}

// Streaming deltas arrive token-by-token and alternate between the model's
// reasoning channel and its text channel. Track which one is currently open so
// each gets a single labeled header instead of repeating it per token.
let openChannel: "reasoning" | "text" | null = null;
const openChannelBlock = (channel: "reasoning" | "text", label: string) => {
  if (openChannel === channel) return;
  if (openChannel !== null) process.stdout.write("\n");
  process.stdout.write(label);
  openChannel = channel;
};
const closeChannelBlock = () => {
  if (openChannel === null) return;
  process.stdout.write("\n");
  openChannel = null;
};

const result = await runAgent({
  model: new OpenAICompatibleModel({
    apiKey,
    model,
    baseURL: process.env.LLM_BASE_URL,
    // Turn thinking on and let the provider pick the right per-family
    // chat_template_kwargs from the model id — GLM gets
    // `enable_thinking`+`clear_thinking`, DeepSeek gets `thinking`, etc. — so
    // prior-turn reasoning resent on tool-call turns actually round-trips.
    // (See agent-loop-core/providers/reasoning-kwargs.ts.)
    thinking: "on",
  }),
  memory: new SessionMemoryStore(),
  sessionId: "running-product-demo",
  prompt:
    `Compute the product of these ${FACTOR_COUNT} numbers: ${FACTORS.join(", ")}.\n` +
    "Work strictly left to right as a running product. Do EXACTLY ONE multiplication per step: " +
    "call the shell tool once (e.g. `echo $((a * b))`) to multiply the current running product by the next number, " +
    "report the new running product, then stop and continue with the next number on the following step. " +
    "Do not multiply more than two numbers in a single shell call, and do not shortcut by computing the whole product at once. " +
    "After the last number, state the final product.",
  system:
    "You are a precise coding assistant. Use the shell tool to do arithmetic one step at a time; never compute the answer in your head.",
  tools: [searchTool(bunSearchBackend()), shellTool(bunShellBackend())],
  maxSteps: 15,
  onEvent: (event) => {
    switch (event.type) {
      case AgentEventType.AgentStart:
        console.log(color(ANSI.bold + ANSI.cyan, `\n=== agent start (session: ${event.sessionId}) ===`));
        break;
      case AgentEventType.TurnStart:
        closeChannelBlock();
        console.log(color(ANSI.bold + ANSI.blue, `\n--- step ${event.step} ---`));
        break;
      case AgentEventType.ReasoningDelta:
        openChannelBlock("reasoning", color(ANSI.gray, "  💭 reasoning: "));
        process.stdout.write(color(ANSI.gray, event.text));
        break;
      case AgentEventType.TextDelta:
        openChannelBlock("text", color(ANSI.cyan, "  💬 text: "));
        process.stdout.write(color(ANSI.cyan, event.text));
        break;
      case AgentEventType.ToolStart:
        closeChannelBlock();
        console.log(color(ANSI.yellow, `\n  → ${event.toolName}(${JSON.stringify(event.args)})`));
        break;
      case AgentEventType.ToolEnd: {
        const tag = event.isError ? "error" : "ok";
        const body = `  ← ${event.toolName} [${tag}]: ${event.result.replace(/\n/g, " ").slice(0, 200)}`;
        console.log(color(event.isError ? ANSI.red : ANSI.green, body));
        break;
      }
      case AgentEventType.AgentEnd:
        closeChannelBlock();
        console.log(color(ANSI.bold + ANSI.cyan, `\n=== agent end (${event.steps} steps) ===`));
        break;
    }
  },
});

console.log(`\nSteps taken: ${result.steps}`);
console.log(`Final answer: ${result.messages.at(-1)?.content}`);
