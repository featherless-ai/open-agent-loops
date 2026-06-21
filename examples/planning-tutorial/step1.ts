/**
 * Planning tutorial — Step 1: give the model a to-do list.
 *
 * One growing program, built up across examples/planning-tutorial/step1..4.ts.
 * Here: a task agent with three tools and a `todo_*` list it uses to track
 * multi-step work — append a step, flip it in_progress, then done.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/planning-tutorial/step1.ts
 */
// #region step1
import {
  AgentEventType,
  defineTool,
  formatTodoList,
  InMemoryTodoStore,
  runAgent,
  SessionMemoryStore,
  todoListTools,
} from "../../agent-core/index.ts";
import type { AgentEvent } from "../../agent-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-core/providers/openai-compatible.ts";
import { z } from "zod";

const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  console.error("Set LLM_API_KEY (see .env.example).");
  process.exit(1);
}

// DeepSeek V4 tool-calls cleanly; GLM emits broken empty-key tool args.
const model = new OpenAICompatibleModel({
  apiKey,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
  model: process.env.LLM_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash",
  thinking: "on",
});

// Three small tools the task needs. Pure functions — the focus is the planning,
// not these.
const wordCount = defineTool({
  name: "word_count",
  description: "Count the words in a block of text.",
  parameters: z.object({ text: z.string().describe("The text to measure.") }),
  execute: ({ text }) => ({ content: `${text.trim().split(/\s+/).filter(Boolean).length} words.` }),
});
const slugify = defineTool({
  name: "slugify",
  description: "Turn a title into a lowercase, hyphenated URL slug.",
  parameters: z.object({ title: z.string().describe("The title to slugify.") }),
  execute: ({ title }) => ({
    content: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
  }),
});
const saveDraft = defineTool({
  name: "save_draft",
  description: "Save a post draft under its slug. Returns the file path.",
  parameters: z.object({
    slug: z.string().describe("URL slug; used as the filename."),
    body: z.string().describe("The post body to save."),
  }),
  execute: ({ slug }) => ({ content: `Saved draft to drafts/${slug}.md` }),
});

// Construct the to-do store ONCE. Like `memory`, reusing it is what makes the
// list durable working memory the model can revise across turns.
const todos = new InMemoryTodoStore();

const system = [
  "You are a task agent. For multi-step work, keep a to-do list: append a step per",
  "task, set it in_progress before you start, and done when you finish. Use the",
  "tools provided instead of doing the work in your head.",
].join("\n");

const post = [
  "Title: Hello, Agents",
  "",
  "Body: Agents are small programs that decide what to do next by calling tools",
  "in a loop. Give one a goal and a few capabilities and it will plan, act, and",
  "check its own work until the goal is met.",
].join("\n");

// Render every event the loop emits, including the dimmed reasoning channel.
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
      console.log(`← ${e.toolName} [${e.isError ? "error" : "ok"}]: ${e.result}`);
      break;
  }
}

await runAgent({
  model,
  memory: new SessionMemoryStore(),
  sessionId: "planning-step1",
  system,
  // The to-do tools sit alongside your own tools — all plain Tool[].
  tools: [wordCount, slugify, saveDraft, ...todoListTools(todos)],
  prompt: `Get this blog post ready to publish — measure its length, make a URL slug from the title, and save the draft:\n\n${post}`,
  maxSteps: 15,
  onEvent: render,
});

// The list is canonical state, queried fresh from the store — not reconstructed.
console.log(`\n${formatTodoList(todos.read(true))}`);
// #endregion
