/**
 * Live "number test": does prior-turn reasoning round-trip on Featherless?
 *
 * We plant a random 10-digit secret in ONE place — the previous assistant turn's
 * REASONING channel (`reasoning` → sent as `reasoning_content`) — and never in
 * any visible `content`. Then the next user turn asks the model to repeat the
 * exact number. If the model can produce it, the only way it could have seen the
 * digits is through the reasoning round-trip; if it can't, the channel was
 * dropped. (A random 10-digit number makes a coincidental guess ~1e-10.)
 *
 * Four knobs per model, mapped to each family's real dialect via the reasoning
 * profile (agent-loop-core/providers/reasoning-kwargs.ts):
 *
 *   off      — toggle thinking OFF; drop the planted reasoning.   expect: NO recall
 *   on       — toggle ON, NO continuity kwarg, reasoning resent.  expect: family-dependent
 *   preserve — toggle ON + continuity ON (clear_thinking:false /  expect: RECALL
 *              preserve_thinking:true), reasoning resent.
 *   clear    — toggle ON + continuity OFF (clear_thinking:true /  expect: NO recall
 *              preserve_thinking:false). Families with no continuity
 *              kwarg (DeepSeek, Qwen) emulate "clear" by NOT resending.
 *
 * The headline contrasts: `on` vs `preserve` isolates the continuity kwarg (GLM
 * drops inbound reasoning unless clear_thinking:false); `preserve` vs `clear`
 * shows preserve/clear actually toggling the channel.
 *
 * Run it (LLM_API_KEY / LLM_BASE_URL from .env):
 *   bun run system-tests/reasoning-number-test.ts
 *   MODELS=agentic REPS=3 CONC=8 bun run system-tests/reasoning-number-test.ts
 *   MODELS="zai-org/GLM-5.2" REPS=5 CONC=4 bun run system-tests/reasoning-number-test.ts
 */

import { assistantMessage, StreamEventType, userMessage } from "../agent-loop-core/index.ts";
import type { Message } from "../agent-loop-core/index.ts";
import { OpenAICompatibleModel } from "../agent-loop-core/providers/openai-compatible.ts";
import { reasoningProfileFor } from "../agent-loop-core/providers/reasoning-kwargs.ts";
import type { ReasoningProfile } from "../agent-loop-core/providers/reasoning-kwargs.ts";
import agenticModels from "./agentic-models.json";

// Minimal ANSI helpers (kept local so system-tests stay independent of examples/).
// Colors disabled when stdout isn't a TTY or NO_COLOR is set.
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const ANSI = {
  reset: "\x1b[0m", bold: "\x1b[1m", gray: "\x1b[90m", red: "\x1b[31m",
  green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m", cyan: "\x1b[36m",
} as const;
const color = (code: string, text: string) => (useColor ? `${code}${text}${ANSI.reset}` : text);

const SECRET = "3281932819";

// ─── Agentic model catalog ───────────────────────────────────────────────────
// The list of agentic reasoners lives in ./agentic-models.json — the 32 of 43
// reasoning-capable entries from the feather-app launch-agent dropdown
// (platform/apps/feather-app/composables/use-agent-model-access.ts, AGENT_MODELS).
// The other 11 dropdown entries are agentic but NON-reasoning (Kimi-K2-Instruct,
// Qwen3-Coder/*-Instruct/VL-Instruct, Llama-3.3, Mistral-Small, Hermes, Nemotron)
// — no reasoning channel to round-trip — and the non-agentic models (RP finetunes,
// embeddings, guard) were never in the dropdown.
//
// Each JSON entry carries id + family + a snapshot of the catalog reasoning dialect
// (toggle / default / interleaved). The snapshot is for display; the live run still
// derives real behavior from reasoning-kwargs.ts via reasoningProfileFor() below.

/** One agentic model: id, family, and a snapshot of its catalog reasoning dialect. */
interface AgenticModel {
  id: string;
  family: "GLM" | "Kimi" | "MiniMax" | "DeepSeek" | "Qwen" | "Gemma" | "Step";
  toggle: "enable_thinking" | "thinking" | null;
  defaultThinking: "on" | "off";
  interleaved: boolean;
  /** Continuity kwargs merged while thinking is on (e.g. { clear_thinking: false }). */
  whenOn?: Record<string, unknown> | null;
}

const AGENTIC_MODELS = agenticModels as AgenticModel[];

// Selectable model sets. Pick one with MODELS=<preset> (e.g. MODELS=agentic), or
// pass an explicit comma list (MODELS="zai-org/GLM-5.1,deepseek-ai/DeepSeek-V4-Pro").
// Default is `latest`.
const PRESETS: Record<string, string[]> = {
  // All agentic reasoners — derived from AGENTIC_MODELS above (single source).
  agentic: AGENTIC_MODELS.map((m) => m.id),
  // Latest-generation reasoner per family (heavily-used models, one per family so
  // it stays maintainable). All are catalogued in reasoning-kwargs.ts — MiMo-V2
  // (enable_thinking, default off) and gpt-oss (always-on) were verified live and
  // added; MiniMax-M3 is the newest M-line (interleaved, no off toggle). MiMo and
  // gpt-oss are reasoners but NOT yet in the feather-app `agentic` dropdown.
  latest: [
    "zai-org/GLM-5.2",
    "moonshotai/Kimi-K2.6",
    "deepseek-ai/DeepSeek-V4-Pro",
    "deepseek-ai/DeepSeek-V4-Flash",
    "Qwen/Qwen3.6-35B-A3B",
    "MiniMaxAI/MiniMax-M3",
    "google/gemma-4-31B-it",
    "XiaomiMiMo/MiMo-V2-Flash",
    "openai/gpt-oss-120b",
  ],
};

type Condition = "off" | "on" | "preserve" | "clear";
const ALL_CONDITIONS: Condition[] = ["off", "on", "preserve", "clear"];
// COND=preserve,clear restricts the matrix (handy for diagnosing one cell).
const CONDITIONS: Condition[] = (process.env.COND
  ? (process.env.COND.split(",").map((c) => c.trim()) as Condition[])
  : ALL_CONDITIONS
).filter((c) => ALL_CONDITIONS.includes(c));
// DEBUG=1 prints each call's visible answer + whether the secret hit reasoning.
const debug = process.env.DEBUG === "1";

// What we expect the round-trip to do per condition. `on` is family-dependent —
// only the continuity-kwarg families (GLM, Kimi) drop reasoning without it.
const EXPECT: Record<Condition, "recall" | "no recall" | "depends"> = {
  off: "no recall",
  on: "depends",
  preserve: "recall",
  clear: "no recall",
};

const apiKey = process.env.LLM_API_KEY;
const baseURL = process.env.LLM_BASE_URL;
if (!apiKey) {
  console.error("Set LLM_API_KEY (see .env.example).");
  process.exit(1);
}

// MODELS unset → `latest` preset; MODELS=<preset> → that preset; else comma list.
const models = !process.env.MODELS
  ? PRESETS.latest
  : (PRESETS[process.env.MODELS] ?? process.env.MODELS.split(",").map((m) => m.trim()).filter(Boolean));
const reps = Number(process.env.REPS ?? "3");
const concurrency = Number(process.env.CONC ?? "5");

/**
 * Per-condition wire plan for a family: which `chat_template_kwargs` to send and
 * whether to resend the planted reasoning. Derives the continuity key/value from
 * the profile's `whenOn` (GLM `clear_thinking:false`, Kimi `preserve_thinking:true`),
 * so the "off" value is just its boolean negation.
 */
function plan(
  profile: ReasoningProfile,
  condition: Condition,
): { kwargs: Record<string, unknown>; resendReasoning: boolean } {
  const toggle = profile.toggleKey ? { [profile.toggleKey]: true } : {};
  const toggleOff = profile.toggleKey ? { [profile.toggleKey]: false } : {};

  const whenOn = profile.whenOn ?? {};
  const contKey = Object.keys(whenOn)[0]; // e.g. "clear_thinking" | "preserve_thinking"
  const contOn = whenOn;
  const contOff = contKey ? { [contKey]: !whenOn[contKey] } : {};

  switch (condition) {
    case "off":
      return { kwargs: toggleOff, resendReasoning: false };
    case "on":
      return { kwargs: toggle, resendReasoning: true };
    case "preserve":
      return { kwargs: { ...toggle, ...contOn }, resendReasoning: true };
    case "clear":
      // Families with a continuity kwarg flip it (server drops the reasoning);
      // families without one emulate "clear" by simply not resending it.
      return contKey
        ? { kwargs: { ...toggle, ...contOff }, resendReasoning: true }
        : { kwargs: toggle, resendReasoning: false };
  }
}

/** The 3-turn history: secret lives ONLY in the assistant turn's reasoning. */
function buildMessages(resendReasoning: boolean): Message[] {
  return [
    userMessage({
      content:
        "Pick a secret 10-digit number and commit it to memory. Keep it ONLY in your " +
        "private reasoning — do NOT write it in your visible reply. When ready, reply exactly: Ready.",
    }),
    assistantMessage({
      content: "Ready.",
      ...(resendReasoning
        ? { reasoning: `The number I am thinking about is ${SECRET}. I will keep it private and not reveal it in my visible answer.` }
        : {}),
    }),
    userMessage({
      content: "What was the exact secret number you picked? Reply with ONLY the 10 digits, nothing else.",
    }),
  ];
}

interface RunResult {
  contentHit: boolean; // digits appeared in the visible answer
  anyHit: boolean; // digits appeared anywhere (answer or fresh reasoning) → round-trip worked
  content: string;
  reasoning: string;
  error?: string;
}

const onlyDigits = (s: string) => s.replace(/\D/g, "");

async function runOnce(model: OpenAICompatibleModel, messages: Message[]): Promise<RunResult> {
  let content = "";
  let reasoning = "";
  try {
    for await (const event of model.stream({ messages })) {
      if (event.type === StreamEventType.TextDelta) content += event.text;
      else if (event.type === StreamEventType.ReasoningDelta) reasoning += event.text;
      else if (event.type === StreamEventType.Error)
        return { contentHit: false, anyHit: false, content, reasoning, error: event.error.message };
    }
  } catch (error) {
    return { contentHit: false, anyHit: false, content, reasoning, error: error instanceof Error ? error.message : String(error) };
  }
  const contentHit = onlyDigits(content).includes(SECRET);
  const anyHit = contentHit || onlyDigits(reasoning).includes(SECRET);
  return { contentHit, anyHit, content, reasoning };
}

/** Bounded-concurrency map — keeps us under the endpoint's rate limits. */
async function pool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function drain(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, drain));
  return results;
}

interface Task {
  modelId: string;
  condition: Condition;
  rep: number;
}

interface Cell {
  hits: number; // anyHit count
  contentHits: number;
  errors: string[];
}

console.log(color(ANSI.bold + ANSI.cyan, `\n=== reasoning number test — secret ${SECRET} ===`));
console.log(color(ANSI.gray, `models: ${models.length} · reps: ${reps} · concurrency: ${concurrency} · base: ${baseURL ?? "(sdk default)"}\n`));

// Resolve each model's profile up front; skip non-reasoning / unknown ids loudly.
const planned = models
  .map((id) => ({ id, profile: reasoningProfileFor(id) }))
  .filter((m): m is { id: string; profile: ReasoningProfile } => {
    if (!m.profile?.reasoning) {
      console.log(color(ANSI.yellow, `  skip ${m.id} — no reasoning profile (would inject nothing)`));
      return false;
    }
    return true;
  });

// One model client per (model, condition): chatTemplateKwargs is fixed per cell.
const tasks: Task[] = [];
for (const { id } of planned) {
  for (const condition of CONDITIONS) {
    for (let rep = 0; rep < reps; rep++) tasks.push({ modelId: id, condition, rep });
  }
}

const clientFor = new Map<string, OpenAICompatibleModel>();
const profileFor = new Map(planned.map((m) => [m.id, m.profile]));
const getClient = (modelId: string, condition: Condition) => {
  const key = `${modelId}::${condition}`;
  let client = clientFor.get(key);
  if (!client) {
    const { kwargs } = plan(profileFor.get(modelId)!, condition);
    client = new OpenAICompatibleModel({
      apiKey,
      model: modelId,
      baseURL,
      chatTemplateKwargs: kwargs,
      params: { temperature: 0, max_tokens: 2048 },
      timeout: 120_000,
    });
    clientFor.set(key, client);
  }
  return client;
};

const cells = new Map<string, Cell>();
const cellKey = (modelId: string, condition: Condition) => `${modelId}::${condition}`;

let done = 0;
await pool(tasks, concurrency, async (task) => {
  const { resendReasoning } = plan(profileFor.get(task.modelId)!, task.condition);
  const result = await runOnce(getClient(task.modelId, task.condition), buildMessages(resendReasoning));
  const key = cellKey(task.modelId, task.condition);
  const cell = cells.get(key) ?? { hits: 0, contentHits: 0, errors: [] };
  if (result.error) cell.errors.push(result.error);
  if (result.anyHit) cell.hits++;
  if (result.contentHit) cell.contentHits++;
  cells.set(key, cell);
  done++;
  if (debug) {
    const flag = result.error
      ? color(ANSI.red, "ERR " + result.error.slice(0, 80))
      : `${result.anyHit ? color(ANSI.green, "HIT") : color(ANSI.yellow, "miss")}` +
        ` content=${JSON.stringify(result.content.replace(/\s+/g, " ").trim().slice(0, 90))}` +
        ` reasoningHadSecret=${onlyDigits(result.reasoning).includes(SECRET)}` +
        ` reasoningLen=${result.reasoning.length}`;
    console.log(`  [${task.modelId} · ${task.condition} · #${task.rep}] ${flag}`);
  } else {
    process.stdout.write(color(ANSI.gray, `\r  ran ${done}/${tasks.length} calls…`));
  }
});
process.stdout.write("\n\n");

// --- report ------------------------------------------------------------------

const W = 34;
const F = 9;
const pad = (s: string, w = 10) => s.padEnd(w);
// Family label per id, from AGENTIC_MODELS — falls back to an owner guess for ids
// outside the agentic set (e.g. the `latest` preset's MiMo / gpt-oss / MiniMax-M3).
const familyOf = new Map<string, string>(AGENTIC_MODELS.map((m) => [m.id, m.family]));
const familyLabel = (id: string): string =>
  familyOf.get(id) ??
  (id.includes("MiMo") ? "MiMo" : id.includes("gpt-oss") ? "gpt-oss" : id.toLowerCase().includes("minimax") ? "MiniMax" : "—");

console.log(color(ANSI.bold, pad("family", F) + pad("model", W) + CONDITIONS.map((c) => pad(c)).join("") + " continuity"));
console.log(color(ANSI.gray, "─".repeat(F + W + CONDITIONS.length * 10 + 11)));

// Group the rows by family for readability.
const rows = [...planned].sort((a, b) => familyLabel(a.id).localeCompare(familyLabel(b.id)) || a.id.localeCompare(b.id));
for (const { id, profile } of rows) {
  const contKey = profile.whenOn ? Object.keys(profile.whenOn)[0] : "(resend-only)";
  const cols = CONDITIONS.map((condition) => {
    const cell = cells.get(cellKey(id, condition))!;
    if (cell.errors.length === reps) return color(ANSI.red, pad("err"));
    const recalled = cell.hits >= Math.ceil(reps / 2);
    const tag = `${cell.hits}/${reps}`;
    // Green when the outcome matches the expectation; "on" is family-dependent so left neutral.
    const expected = EXPECT[condition];
    const ok = expected === "recall" ? recalled : expected === "no recall" ? !recalled : null;
    const c = ok === null ? ANSI.cyan : ok ? ANSI.green : ANSI.red;
    return color(c, pad(tag));
  });
  console.log(color(ANSI.gray, pad(familyLabel(id), F)) + pad(id, W) + cols.join("") + color(ANSI.gray, " " + contKey));
}

console.log(color(ANSI.gray, "\nlegend: cell = (# recalled / reps). green = matches expectation "));
console.log(color(ANSI.gray, "  off → no recall · preserve → recall · clear → no recall · on → family-dependent (cyan)"));
console.log(color(ANSI.gray, "  recall = the planted secret surfaced (answer or fresh reasoning), proving reasoning round-tripped.\n"));

// Surface a couple of distinct errors if any, to explain red 'err' cells.
const allErrors = [...cells.values()].flatMap((c) => c.errors);
if (allErrors.length) {
  const seen = new Set<string>();
  console.log(color(ANSI.yellow, "errors:"));
  for (const e of allErrors) {
    const head = e.slice(0, 160);
    if (seen.has(head)) continue;
    seen.add(head);
    console.log(color(ANSI.red, "  · " + head));
  }
}
