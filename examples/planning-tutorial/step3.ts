/**
 * Planning tutorial — Step 3: author a workflow from a brief.
 *
 * In steps 1–2 the model wrote its own list. Now hand it a prose brief
 * (blog-post.brief.md): the agent decomposes it into to-do steps and runs them,
 * and then we serialize the list it built into a frozen, replayable workflow.json.
 * The highlighted lines are the new part — reading the brief and serializing the
 * plan. prose → plan → artifact.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/planning-tutorial/step3.ts
 */
// #region step3
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentEventType,
  defineTool,
  InMemoryTodoStore,
  runAgent,
  SessionMemoryStore,
  todoListTools,
} from "../../agent-loop-core/index.ts";
import type { AgentEvent } from "../../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-loop-core/providers/openai-compatible.ts";
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

// Read the prose brief — the workflow's source form, authored by a human.
const here = fileURLToPath(new URL(".", import.meta.url));
const brief = readFileSync(join(here, "blog-post.brief.md"), "utf8");
const title = brief.match(/^#\s+(.+)$/m)?.[1] ?? "workflow";
const goal = brief.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? title;

// The agent plans into THIS store (empty — it fills it), then works the plan.
const todos = new InMemoryTodoStore();

// A planner-executor prompt: decompose first with todo_append, then execute.
const system = [
  "You are a workflow planner-executor. Work in two phases:",
  "1. PLAN: break the brief into an ordered list of concrete, single-action steps,",
  "   recording each with todo_append (status pending) and a short id.",
  "2. EXECUTE: work them in order — todo_update to in_progress, do it with the",
  "   right tool, todo_update to done. Keep step text generic so the plan reuses.",
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
  sessionId: "planning-step3",
  system,
  tools: [wordCount, slugify, saveDraft, ...todoListTools(todos)],
  prompt: `Brief:\n${brief}\n\nPost to process:\n${post}`,
  maxSteps: 15,
  onEvent: render,
});

// Compile: the to-do list the AGENT built becomes a frozen, replayable workflow. // [!code highlight]
const workflow = { // [!code highlight:8]
  name: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
  goal,
  instructions:
    "Work the steps in order: set each in_progress, do it with the named tool, then done.",
  toolNames: ["word_count", "slugify", "save_draft"],
  steps: todos.read(true).map(({ id, content }) => ({ id, content })),
};
const out = join(mkdtempSync(join(tmpdir(), "workflow-")), "blog-post.workflow.json"); // [!code highlight]
writeFileSync(out, JSON.stringify(workflow, null, 2)); // [!code highlight]
console.log(`\nThe agent decomposed the brief into ${workflow.steps.length} steps.`);
console.log(`Compiled workflow written to ${out} — replay it in step 4.`);
// #endregion
