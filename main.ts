/**
 * Runnable example: a tool-calling agent run against a real model.
 *
 * The agent searches a plain text file — the opening 1000 lines of Tolstoy's
 * War and Peace (`war-and-peace.txt`) — and counts how many times a character's
 * name appears. An ordinary "search a document, then count" task: it makes its
 * own sequence of search/shell calls, reading what it finds before answering.
 *
 * Run it (LLM_API_KEY and LLM_MODEL come from `.env`):
 *   bun run main.ts
 */

import {
  AgentEventType,
  runAgent,
  searchTool,
  SessionMemoryStore,
  shellTool,
} from "./agent-core/index.ts";
import { OpenAICompatibleModel } from "./agent-core/providers/openai-compatible.ts";
import { bunSearchBackend, bunShellBackend } from "./bun-backends.ts";

const CORPUS_FILE = "war-and-peace.txt";
const CHARACTER = "Pierre";

const apiKey = process.env.LLM_API_KEY;
const model = process.env.LLM_MODEL;
if (!apiKey || !model) {
  console.error("Set LLM_API_KEY and LLM_MODEL (see .env.example).");
  process.exit(1);
}

const result = await runAgent({
  model: new OpenAICompatibleModel({
    apiKey,
    model,
    baseURL: process.env.LLM_BASE_URL,
    // Featherless / GLM-style templates: keep prior-turn reasoning so the
    // thinking resent as `reasoning_content` on tool-call turns round-trips.
    // Without `clear_thinking: false` the server strips it before the model
    // sees it. (Verified empirically against zai-org/GLM-5.1.)
    chatTemplateKwargs: { enable_thinking: true, clear_thinking: false },
  }),
  memory: new SessionMemoryStore(),
  sessionId: "wap-demo",
  prompt:
    `How many times does the name "${CHARACTER}" appear in the file ${CORPUS_FILE}? ` +
    "Use the search tool to confirm it appears, then the shell tool to count the occurrences. " +
    "Verify the number against the actual file before answering.",
  system: "You are a precise coding assistant. Use the tools to find the answer.",
  tools: [searchTool(bunSearchBackend()), shellTool(bunShellBackend())],
  maxSteps: 15,
  onEvent: (event) => {
    switch (event.type) {
      case AgentEventType.ToolStart:
        console.log(`  → ${event.toolName}(${JSON.stringify(event.args)})`);
        break;
      case AgentEventType.ToolEnd:
        console.log(`  ← ${event.toolName}: ${event.result.replace(/\n/g, " ").slice(0, 200)}`);
        break;
    }
  },
});

console.log(`\nSteps taken: ${result.steps}`);
console.log(`Final answer: ${result.messages.at(-1)?.content}`);
