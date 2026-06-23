/**
 * Goal-loop tutorial — Step 4: add a model's taste.
 *
 * One growing program, built up across examples/goal-tutorial/step1..4.ts — each
 * step is the previous file plus a few lines (highlighted in the docs). Here: a
 * second grader — a fast model via `modelGrader` — is composed with the
 * deterministic spec check, so a round passes only when the structure is correct
 * AND the model judges the copy "punchy". A grader is just a function, so you
 * compose them like any other.
 *
 * Setup (see .env.example at the repo root):
 *   cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
 *
 * Run it (Bun auto-loads .env):
 *   bun run examples/goal-tutorial/step4.ts
 */
// #region step4
import {
  contentToText,
  isAssistantMessage,
  modelGrader, // [!code highlight]
  runGoal,
  SessionMemoryStore,
} from "../../agent-core/index.ts";
import type { Grader, RunResult } from "../../agent-core/index.ts";
import { OpenAICompatibleModel } from "../../agent-core/providers/openai-compatible.ts";

const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  console.error("Set LLM_API_KEY (see .env.example).");
  process.exit(1);
}

// The agent under the loop — any OpenAI-compatible endpoint works.
const model = new OpenAICompatibleModel({
  apiKey,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
  model: process.env.LLM_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash",
  thinking: "on",
});

// A separate, smaller/faster model just for grading: it only needs to return a // [!code highlight:8]
// JSON verdict, never call tools. Point it wherever you like.
const graderModel = new OpenAICompatibleModel({
  apiKey,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
  model: process.env.GRADER_MODEL ?? "deepseek-ai/DeepSeek-V4-Flash",
  thinking: "off",
});

// The spec, stated once: it is both the prompt the agent reads and the checklist
// the grader enforces.
const goal = [
  "Write a 3-line product blurb for a password manager.",
  "Rules:",
  "- exactly 3 lines",
  '- every line starts with "- "',
  "- each line is at most 60 characters",
  "- across the three lines, mention cost, speed, and security",
  "- it should sound punchy and benefit-driven, not generic",
].join("\n");

// Pull the agent's latest text out of a round's result.
function latestText(result: RunResult): string {
  const last = [...result.newMessages].reverse().find(isAssistantMessage);
  return last ? contentToText(last.content).trim() : "";
}

// The deterministic half: check the mechanical rules in plain code and hand back
// concrete feedback, which runGoal feeds in as the next round's prompt.
const specGrader: Grader = ({ result }) => {
  const text = latestText(result);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const problems: string[] = [];

  if (lines.length !== 3) problems.push(`use exactly 3 lines (you wrote ${lines.length})`);
  lines.forEach((line, i) => {
    if (!line.startsWith("- ")) problems.push(`line ${i + 1} must start with "- "`);
    if (line.length > 60) problems.push(`line ${i + 1} is ${line.length} chars (max 60)`);
  });
  for (const word of ["cost", "speed", "security"]) {
    if (!text.toLowerCase().includes(word)) problems.push(`mention "${word}"`);
  }

  if (problems.length === 0) return { done: true };
  return { done: false, feedback: `Fix these and resend all 3 lines:\n- ${problems.join("\n- ")}` };
};

// Compose the two: check the cheap, deterministic rules first, and only spend a // [!code highlight:8]
// model call on "taste" once the structure is already correct.
const fastGrader = modelGrader({ model: graderModel });
const grader: Grader = async (ctx) => {
  const structural = await specGrader(ctx);
  if (!structural.done) return structural;
  return fastGrader(ctx);
};

const outcome = await runGoal({
  goal,
  grader, // [!code highlight]
  base: { model, memory: new SessionMemoryStore(), sessionId: "goal-tutorial" },
  maxRounds: 4,
  onRound: ({ round, grade }) => {
    console.log(`\n── round ${round}: ${grade.done ? "✓ passed" : "✗ needs work"}`);
    if (!grade.done && grade.feedback) console.log(grade.feedback);
  },
});

if (outcome.done) {
  console.log(`\n✓ goal met in ${outcome.rounds} round(s):\n`);
} else {
  console.log(`\n✗ stopped at the ${outcome.rounds}-round cap; best effort so far:\n`);
}
console.log(latestText(outcome.result));
// #endregion
