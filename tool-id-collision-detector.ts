/**
 * tool_call_id collision detector.
 *
 * Probes a model over several real turns (feeding each tool result back) and
 * flags a collision whenever a tool_call_id REPEATS across turns. It doesn't
 * assume the buggy value is "call_0" — any id that recurs is a collision, so
 * this catches GLM/Qwen-style positional resets *and* any other scheme that
 * fails to stay unique.
 *
 * Use as a CLI:
 *   bun run tool-id-collision-detector.ts                       # default model list
 *   bun run tool-id-collision-detector.ts "zai-org/GLM-5.2" "deepseek-ai/DeepSeek-V4-Pro"
 *
 * Or import `detectCollision` as a guard (e.g. gate a model out of your catalogue
 * in CI before you trust it with an id-keyed runtime).
 */
import OpenAI from "openai";
import type {
  ChatCompletionTool,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  console.error("Set LLM_API_KEY (see .env).");
  process.exit(1);
}
const baseURL = process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1";
const client = new OpenAI({ apiKey, baseURL });

// Heavy thinking models can burn the budget on reasoning before emitting the
// tool call (looks like a false NO-TOOL-CALL). Bump MAX_TOKENS for such lists.
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 512);

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "calculator",
      description: "add two numbers",
      parameters: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
      },
    },
  },
];

export type Verdict = "ok" | "collision" | "no-tool-call" | "error";

export interface CollisionReport {
  model: string;
  verdict: Verdict;
  /** The tool_call_id seen on each turn, in order. */
  ids: string[];
  note?: string;
}

/** One addition per turn: [a, b, sum-fed-back-as-the-tool-result]. */
const TURNS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 2, 3],
  [3, 4, 7],
  [5, 6, 11],
];

/** The flattened tool call a turn elicited, plus how we got it. */
interface ElicitedCall {
  id: string;
  name: string;
  arguments: string;
  content: string | null;
  /** True when "auto" declined and we had to force the call with "required". */
  forced: boolean;
}

/**
 * Elicit a tool call for the current history: try natural `"auto"` first, then
 * force it with `"required"` if the model declined — so a probe always gets an
 * id to inspect (e.g. DeepSeek-V4-Pro sometimes answers in text under "auto").
 * Returns null only if even forcing yields no usable call. A hard error on the
 * natural attempt propagates; a failure of the forced attempt is swallowed.
 */
async function elicitToolCall(
  model: string,
  messages: ChatCompletionMessageParam[],
): Promise<ElicitedCall | null> {
  const choices = ["auto", "required"] as const;
  for (let i = 0; i < choices.length; i += 1) {
    // Errors propagate to detectCollision's try/catch → an honest "error" verdict,
    // so a 429/5xx is never silently mis-reported as "no-tool-call".
    const res = await client.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: choices[i],
      max_tokens: MAX_TOKENS,
    });
    const msg = res.choices[0]?.message;
    const tc = msg?.tool_calls?.[0];
    if (msg && tc && tc.type === "function" && tc.id) {
      return {
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
        content: msg.content ?? null,
        forced: i === 1,
      };
    }
  }
  return null;
}

/**
 * Probe `model` over `turns` real round-trips and report whether any
 * tool_call_id repeated. Throws nothing — failures become an "error" verdict.
 */
export async function detectCollision(model: string, turns = TURNS.length): Promise<CollisionReport> {
  const messages: ChatCompletionMessageParam[] = [];
  const ids: string[] = [];
  let forced = 0;
  try {
    for (let t = 0; t < turns; t += 1) {
      const [a, b, sum] = TURNS[t]!;
      messages.push({
        role: "user",
        content: t === 0 ? `Add ${a} + ${b} with the calculator.` : `Now add ${a} + ${b}.`,
      });

      const call = await elicitToolCall(model, messages);
      if (!call) {
        return {
          model,
          verdict: "no-tool-call",
          ids,
          note: `turn ${t + 1} returned no tool call (even with tool_choice:"required")`,
        };
      }
      ids.push(call.id);
      if (call.forced) forced += 1;

      // Feed the assistant tool call + its result back so the next turn is genuinely multi-turn.
      messages.push({
        role: "assistant",
        content: call.content,
        tool_calls: [
          { id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } },
        ],
      });
      messages.push({ role: "tool", tool_call_id: call.id, content: String(sum) });
    }

    const unique = new Set(ids);
    const fNote = forced ? `${forced}/${ids.length} turn(s) needed tool_choice:"required"` : undefined;
    if (unique.size < ids.length) {
      return {
        model,
        verdict: "collision",
        ids,
        note: [`${ids.length} calls → ${unique.size} unique id(s)`, fNote].filter(Boolean).join(" · "),
      };
    }
    return { model, verdict: "ok", ids, ...(fNote ? { note: fNote } : {}) };
  } catch (err) {
    return { model, verdict: "error", ids, note: (err as Error).message.slice(0, 100) };
  }
}

// --- CLI ---------------------------------------------------------------------

const DEFAULT_MODELS = [
  "zai-org/GLM-5.2",
  "Qwen/Qwen3.6-27B",
  "deepseek-ai/DeepSeek-V4-Pro",
  "deepseek-ai/DeepSeek-V4-Flash",
  "Qwen/Qwen2.5-7B-Instruct",
];

const ICON: Record<Verdict, string> = { ok: "✅", collision: "❌", "no-tool-call": "⚠️ ", error: "💥" };

/** Run `fn` over `items` with at most `limit` in flight — Featherless caps concurrency. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Pull tool_use models from the live catalogue, with an optional substring filter + cap. */
async function catalogueModels(filter: string | undefined, cap: number): Promise<string[]> {
  const res = await fetch(`${baseURL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const body = (await res.json()) as { data?: Array<{ id: string; features?: { tool_use?: boolean } }> };
  let ids = (body.data ?? []).filter((m) => m.features?.tool_use).map((m) => m.id);
  if (filter) ids = ids.filter((id) => id.toLowerCase().includes(filter.toLowerCase()));
  return ids.slice(0, cap);
}

const argv = process.argv.slice(2);
// Probe a few at a time rather than firing the whole list at once (override with CONCURRENCY=n).
const concurrency = Number(process.env.CONCURRENCY ?? 3);

// Three input modes:
//   (no args)                                  → built-in DEFAULT_MODELS
//   --catalogue [substring-filter] [cap]       → auto-discover tool_use models
//   <model id> <model id> ...                  → explicit list
let models: string[];
if (argv[0] === "--catalogue") {
  const rest = argv.slice(1);
  const filter = rest.find((a) => !/^\d+$/.test(a));
  const cap = Number(rest.find((a) => /^\d+$/.test(a)) ?? 40);
  models = await catalogueModels(filter, cap);
  console.log(`Catalogue: ${models.length} tool_use model(s)${filter ? ` matching "${filter}"` : ""} (cap ${cap})`);
} else {
  models = argv.length > 0 ? argv : DEFAULT_MODELS;
}

const turns = Math.min(Number(process.env.TURNS ?? TURNS.length), TURNS.length);
console.log(
  `Probing ${models.length} model(s) · ${baseURL} · concurrency ${concurrency} · ${turns} turns · max_tokens ${MAX_TOKENS}\n`,
);
// Stream each verdict as it lands (completion order), with a progress counter.
let done = 0;
const printReport = (r: CollisionReport): void => {
  done += 1;
  console.log(`[${String(done).padStart(2)}/${models.length}] ${ICON[r.verdict]} ${r.verdict.toUpperCase().padEnd(13)} ${r.model}`);
  if (r.ids.length) console.log(`         ids: ${r.ids.join("  ,  ")}`);
  if (r.note) console.log(`         ${r.note}`);
};

const reports = await mapPool(models, concurrency, async (m) => {
  const r = await detectCollision(m, turns);
  printReport(r);
  return r;
});

const colliding = reports.filter((r) => r.verdict === "collision").map((r) => r.model);
const ok = reports.filter((r) => r.verdict === "ok").map((r) => r.model);
console.log(`\n── summary ──`);
console.log(`${colliding.length} collision · ${ok.length} ok · ${reports.length - colliding.length - ok.length} no-tool-call/error`);
if (colliding.length) console.log(`colliders: ${colliding.join(", ")}`);
// Non-zero exit if any model collides — usable as a CI gate.
if (colliding.length) process.exitCode = 1;
