import { beforeAll, describe, expect, test } from "bun:test";
import { assistantMessage, StreamEventType, userMessage } from "../agent-loop-core/index";
import type { Message } from "../agent-loop-core/index";
import { OpenAICompatibleModel } from "../agent-loop-core/providers/openai-compatible";
import { reasoningProfileFor } from "../agent-loop-core/providers/reasoning-kwargs";

/**
 * LIVE assertion of the reasoning-field asymmetry (GLM / Featherless).
 *
 * The note has two halves. The DETERMINISTIC half is already covered offline:
 *   - the `{enable_thinking, clear_thinking}` recipe → reasoning-kwargs.test.ts
 *   - attaching the prior thought back as `reasoning_content` → openai-compatible.test.ts
 * This file covers the EMPIRICAL half, which only a real endpoint can show: a
 * secret planted ONLY in the previous assistant turn's reasoning channel
 * round-trips (model can repeat it) IFF continuity is preserved — i.e. GLM needs
 * `clear_thinking:false`; with the continuity cleared or thinking off, the
 * channel is dropped and the model can't recall it.
 *
 * Opt-in (skipped by default so the offline suite / CI stays green):
 *   LIVE_REASONING=1 LLM_API_KEY=... \
 *     [LIVE_REASONING_MODEL=zai-org/GLM-5.1] [LLM_BASE_URL=...] [LIVE_REASONING_REPS=3] \
 *     bun test reasoning-asymmetry.live
 *
 * Defaults to GLM-5.1 — the model the asymmetry was verified on and the most
 * reliable round-trip (3/3). Older GLM (5 / 4.7) preserve-by-default, so they'd
 * also pass on plain "on"; newer GLM (5.1 / 5.2) clear-by-default, which is why
 * the explicit `clear_thinking:false` is the load-bearing part of the recipe.
 */

const LIVE = Boolean(process.env.LLM_API_KEY) && process.env.LIVE_REASONING === "1";
const MODEL = process.env.LIVE_REASONING_MODEL ?? "zai-org/GLM-5.1";
const BASE_URL = process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1";
const REPS = Number(process.env.LIVE_REASONING_REPS ?? "3");
const SECRET = "3281932819";
const PER_CALL_MS = 120_000;

/** 3-turn history: the secret lives ONLY in the assistant turn's reasoning. */
function buildMessages(includeReasoning: boolean): Message[] {
  return [
    userMessage({
      content:
        "Pick a secret 10-digit number and commit it to memory. Keep it ONLY in your " +
        "private reasoning — do NOT write it in your visible reply. When ready, reply exactly: Ready.",
    }),
    assistantMessage({
      content: "Ready.",
      ...(includeReasoning
        ? { reasoning: `The number I am thinking about is ${SECRET}. I will keep it private and not reveal it in my visible answer.` }
        : {}),
    }),
    userMessage({
      content: "What was the exact secret number you picked? Reply with ONLY the 10 digits, nothing else.",
    }),
  ];
}

const onlyDigits = (s: string) => s.replace(/\D/g, "");

/** One call; true when the planted secret surfaced anywhere (answer or fresh reasoning). */
async function recalledOnce(kwargs: Record<string, unknown>, includeReasoning: boolean): Promise<boolean> {
  const model = new OpenAICompatibleModel({
    apiKey: process.env.LLM_API_KEY,
    model: MODEL,
    baseURL: BASE_URL,
    chatTemplateKwargs: kwargs,
    params: { temperature: 0, max_tokens: 2048 },
    timeout: PER_CALL_MS,
  });
  let content = "";
  let reasoning = "";
  for await (const event of model.stream({ messages: buildMessages(includeReasoning) })) {
    if (event.type === StreamEventType.TextDelta) content += event.text;
    else if (event.type === StreamEventType.ReasoningDelta) reasoning += event.text;
    else if (event.type === StreamEventType.Error) throw event.error;
  }
  return onlyDigits(content).includes(SECRET) || onlyDigits(reasoning).includes(SECRET);
}

async function recallRate(kwargs: Record<string, unknown>, includeReasoning: boolean): Promise<number> {
  let hits = 0;
  for (let i = 0; i < REPS; i++) if (await recalledOnce(kwargs, includeReasoning)) hits++;
  return hits / REPS;
}

describe.skipIf(!LIVE)(`reasoning asymmetry — ${MODEL} (live)`, () => {
  // Derive the family's real dialect so the test adapts if pointed at another
  // model: preserve = toggle on + continuity on; clear = continuity flipped off
  // (or, for families with no continuity kwarg, simply not resending); off =
  // toggle off. The note is GLM-specific, hence the GLM-5.1 default.
  const profile = reasoningProfileFor(MODEL);
  const toggleOn = profile?.toggleKey ? { [profile.toggleKey]: true } : {};
  const toggleOff = profile?.toggleKey ? { [profile.toggleKey]: false } : {};
  const whenOn = profile?.whenOn ?? {};
  const contKey = Object.keys(whenOn)[0];
  const contOff = contKey ? { [contKey]: !whenOn[contKey] } : {};

  const rates: { preserve: number; clear: number; off: number } = { preserve: 0, clear: 0, off: 0 };

  beforeAll(async () => {
    rates.preserve = await recallRate({ ...toggleOn, ...whenOn }, true);
    rates.clear = contKey
      ? await recallRate({ ...toggleOn, ...contOff }, true) // server drops the resent reasoning
      : await recallRate(toggleOn, false); // no continuity kwarg → emulate clear by not resending
    rates.off = await recallRate(toggleOff, false);
    // eslint-disable-next-line no-console
    console.log(`  [${MODEL}] recall — preserve=${rates.preserve} clear=${rates.clear} off=${rates.off} (n=${REPS})`);
  }, PER_CALL_MS * REPS * 3 + 30_000);

  // The asymmetry itself: preserving continuity round-trips strictly more than
  // clearing it. This holds across every GLM version regardless of the default.
  test("preserved continuity round-trips strictly more than cleared", () => {
    expect(rates.preserve).toBeGreaterThan(rates.clear);
  });

  // Positive: with continuity preserved the planted thought is actually recalled.
  test("preserve (clear_thinking:false) recalls the planted secret", () => {
    expect(rates.preserve).toBeGreaterThanOrEqual(0.5);
  });

  // Negative: an explicit clear is honored — the channel is dropped.
  test("clear (clear_thinking:true) drops the planted secret", () => {
    expect(rates.clear).toBe(0);
  });

  // Negative: thinking off carries nothing forward.
  test("thinking off drops the planted secret", () => {
    expect(rates.off).toBe(0);
  });
});
