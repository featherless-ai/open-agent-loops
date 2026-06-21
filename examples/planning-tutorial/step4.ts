/**
 * Planning tutorial — Step 4: replay a frozen workflow.
 *
 * Step 3 compiled a workflow.json. Here there is no planning phase: we deserialize
 * the steps, seed them into a to-do list, resolve the tool *names* to real tools,
 * and run. The model executes a plan it didn't have to invent — deterministic and
 * reviewable. The highlighted lines are the hydration. artifact → replay.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/planning-tutorial/step4.ts
 */
// #region step4
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentEventType,
  defineTool,
  formatTodoList,
  InMemoryTodoStore,
  runAgent,
  SessionMemoryStore,
  todoListTools,
  ToolRegistry,
} from "../../agent-core/index.ts";
import type { AgentEvent } from "../../agent-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-core/providers/openai-compatible.ts";
import { z } from "zod";

const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  console.error("Set LLM_API_KEY (see .env.example).");
  process.exit(1);
}

const model = new OpenAICompatibleModel({
  apiKey,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
  model: process.env.LLM_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash",
  thinking: "on",
});

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

// A name → tool resolver. resolve(names) throws on an unknown name.
const registry = new ToolRegistry([wordCount, slugify, saveDraft]);

// Deserialize the frozen workflow (the kind step 3 produced).
const here = fileURLToPath(new URL(".", import.meta.url));
const workflow = JSON.parse(readFileSync(join(here, "blog-post.workflow.json"), "utf8"));

// Hydrate onto existing seams: names → tools, steps → a pre-seeded list.
const stepTools = registry.resolve(workflow.toolNames); // [!code highlight]
const todos = new InMemoryTodoStore(); // [!code highlight]
for (const step of workflow.steps) todos.append(step.id, step.content, "pending"); // [!code highlight]

const system = [
  `You are executing the "${workflow.name}" workflow.`,
  `Goal: ${workflow.goal}`,
  workflow.instructions,
  "Your to-do list is pre-seeded with the steps — call todo_list to see them.",
].join("\n");

const post = [
  "Title: Hello, Agents",
  "",
  "Body: Agents are small programs that decide what to do next by calling tools",
  "in a loop. Give one a goal and a few capabilities and it will plan, act, and",
  "check its own work until the goal is met.",
].join("\n");

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
  sessionId: "planning-step4",
  system,
  tools: [...todoListTools(todos), ...stepTools],
  prompt: post,
  maxSteps: 15,
  onEvent: render,
});

console.log(`\n${formatTodoList(todos.read(true))}`);
// #endregion
