/**
 * Per-model reasoning ("thinking") configuration for OpenAI-compatible endpoints.
 *
 * The same `chat_template_kwargs` body field means different things to different
 * model templates — there is no single key. This module is the one lookup table
 * that maps a model id to the right dialect, so callers don't hardcode a combo
 * that only happens to fit one family:
 *
 * | Family            | toggle key       | continuity (when on)        |
 * | ----------------- | ---------------- | --------------------------- |
 * | GLM (4.7/5/5.1)   | `enable_thinking`| `clear_thinking: false`     |
 * | Kimi K2.5 / K2.6  | `thinking`       | `preserve_thinking: true`   |
 * | DeepSeek V3.1/V4  | `thinking`       | (resend reasoning_content)  |
 * | Qwen3 (original)  | `enable_thinking`| interleaved; resend reasoning |
 * | Qwen3.5 / 3.6     | `enable_thinking`| `preserve_thinking: true`   |
 * | Gemma 4           | `enable_thinking`| —                           |
 *
 * Some families have no runtime toggle: DeepSeek R1, StepFun Step-3.5, and the
 * dedicated Kimi-K2-Thinking always reason, and MiniMax-M2 does *interleaved*
 * thinking (enabled server-side via vLLM's `--reasoning-parser`, not a kwarg). For
 * those, {@link reasoningKwargsFor} injects nothing — the caller's job is only to
 * RETAIN prior reasoning across tool-call turns, which the loop's
 * `prepareRequestMessages` already does.
 *
 * Interleaved and toggleable are independent: the whole Qwen3 series interleaves
 * by default (the chat template's `last_query_index` "rolling checkpoint" keeps
 * `<think>` only for turns after the last user message) yet still honors the
 * `enable_thinking` toggle, and Qwen3.5/3.6 add `preserve_thinking` to retain the
 * FULL history like Kimi. GLM (4.5+) likewise interleaves AND toggles — its
 * `clear_thinking:false` ("Preserved Thinking") is the retention switch.
 * Retaining prior reasoning_content is the caller's job either way.
 *
 * Matching is first-match-wins over the lowercased id; unknown and non-reasoning
 * models resolve to `undefined` (inject nothing) so this is always safe to apply.
 *
 * Every rule below carries a `verified:` link to the primary doc it's drawn from.
 * The umbrella source for parser names + per-family defaults is vLLM's reasoning
 * reference: https://docs.vllm.ai/en/latest/features/reasoning_outputs/
 *
 * @module
 */

/**
 * Desired thinking state for a request.
 *
 * - `"on"` / `"off"` — force the toggle.
 * - `"auto"` — use the family's documented default, injected explicitly (so the
 *   behavior is deterministic regardless of a server's own default kwargs).
 *
 * @group Model
 */
export type ThinkingMode = "on" | "off" | "auto";

/**
 * What a model family's chat template understands about reasoning.
 *
 * @group Model
 */
export interface ReasoningProfile {
  /** Whether this model reasons at all. `false` → never inject kwargs. */
  reasoning: boolean;
  /**
   * The `chat_template_kwargs` key that toggles thinking, or `null` when there
   * is no runtime toggle (always-on reasoners like DeepSeek R1, or interleaved
   * models with no switch like MiniMax-M2). Interleaved ≠ null toggle: Qwen3 and
   * Kimi interleave AND expose a toggle.
   */
  toggleKey: "enable_thinking" | "thinking" | null;
  /** The family's default thinking state, used when the mode is `"auto"`. */
  defaultOn: boolean;
  /**
   * Extra kwargs merged in WHEN THINKING IS ON — continuity of prior-turn
   * reasoning across tool calls (e.g. GLM `clear_thinking:false`, Kimi
   * `preserve_thinking:true`).
   */
  whenOn?: Record<string, unknown>;
  /**
   * The model reasons *between* tool calls (interleaved thinking). Informational:
   * it is enabled by default — either a server-side parser, or the chat template's
   * own `last_query_index` retention (Qwen3) — rather than by the toggle kwarg. The
   * caller must keep prior reasoning in the message history rather than strip it. A
   * family can be both interleaved AND have a toggle (Qwen3, Kimi).
   */
  interleaved: boolean;
}

interface Rule {
  /** Tested against the lowercased model id; first match wins. */
  test: (id: string) => boolean;
  profile: ReasoningProfile;
}

const NON_REASONING: ReasoningProfile = {
  reasoning: false,
  toggleKey: null,
  defaultOn: false,
  interleaved: false,
};

/**
 * Ordered family rules. Specific exclusions (non-reasoning Coder/Instruct
 * variants, always-on lines) come before the broader family rule so the first
 * match wins.
 */
const RULES: Rule[] = [
  // DeepSeek R1 always reasons — no toggle. (Before the generic DeepSeek-V rule.)
  // verified — vLLM lists parser `deepseek_r1` and gives it no enable/disable
  // switch (reasoning is extracted automatically):
  //   https://docs.vllm.ai/en/latest/features/reasoning_outputs/
  {
    test: (id) => id.includes("deepseek-r1"),
    profile: { reasoning: true, toggleKey: null, defaultOn: true, interleaved: false },
  },
  // DeepSeek V3.1 / V3.2 / V4 — `thinking` toggle, default OFF on open-weights.
  // verified — vLLM: "reasoning is disabled by default; to enable it, you must
  // also pass `thinking=True` in your `chat_template_kwargs`" (parser
  // `deepseek_v3`): https://docs.vllm.ai/en/latest/features/reasoning_outputs/
  // NB: DeepSeek's own hosted API uses a DIFFERENT surface —
  // `extra_body={"thinking":{"type":"enabled"}}`, default *enabled* — not this
  // chat_template_kwarg: https://api-docs.deepseek.com/guides/thinking_mode
  {
    test: (id) => id.includes("deepseek-v"),
    profile: { reasoning: true, toggleKey: "thinking", defaultOn: false, interleaved: false },
  },
  // GLM 4.7 / 5 / 5.1 — enable_thinking + clear_thinking continuity, default on,
  // INTERLEAVED. verified — the GLM-4.7 card describes "Interleaved Thinking" (the
  // model "thinks between tool calls and after receiving tool results"), a feature
  // "introduced since GLM-4.5" and enhanced in 4.7 with "Preserved Thinking"
  // (`clear_thinking:false` retains thinking across turns). It shows the exact
  // agentic combo `{enable_thinking:true, clear_thinking:false}` and "thinking mode
  // is enabled by default": https://huggingface.co/zai-org/GLM-4.7 — and Z.AI's
  // thinking-mode guide: "allowing GLM to think between tool calls and after
  // receiving tool results": https://docs.z.ai/guides/capabilities/thinking-mode
  {
    test: (id) => id.includes("glm-"),
    profile: {
      reasoning: true,
      toggleKey: "enable_thinking",
      defaultOn: true,
      whenOn: { clear_thinking: false },
      interleaved: true,
    },
  },
  // Kimi K2 *-Instruct is the non-reasoning line. (Before the generic Kimi rule.)
  // verified — the card: "It is a reflex-grade model without long thinking":
  //   https://huggingface.co/moonshotai/Kimi-K2-Instruct
  { test: (id) => id.includes("kimi-k2-instruct"), profile: NON_REASONING },
  // Kimi-K2-Thinking — the dedicated thinking model: ALWAYS on (no instant mode,
  // no `thinking:false` toggle), interleaved. It resends reasoning_content WITHIN a
  // task but has no `preserve_thinking` kwarg — that full-history switch arrived with
  // the hybrid K2.5/K2.6 line (cf. original Qwen3 vs 3.5), so this line is resend-only.
  // (Before the generic Kimi rule.) verified — the card documents no disable kwarg
  // and is "end-to-end trained to interleave chain-of-thought reasoning with function
  // calls": https://huggingface.co/moonshotai/Kimi-K2-Thinking ; the Kimi platform
  // thinking guide lists `thinking.type:"disabled"` only for k2.5/k2.6/k2.7-code, NOT
  // k2-thinking: https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model
  {
    test: (id) => id.includes("kimi-k2-thinking"),
    profile: { reasoning: true, toggleKey: null, defaultOn: true, interleaved: true },
  },
  // Kimi K2.5 / K2.6 (hybrid) — `thinking` toggle + preserve_thinking (only while
  // on), interleaved. verified — the K2.6 card: think mode = `chat_template_kwargs
  // {thinking:True, preserve_thinking:True}`, instant mode = `{thinking:False}`,
  // "enable preserve_thinking only in think mode", thinking on by default; the Kimi
  // platform guide confirms k2.5/k2.6 accept `thinking.type:"disabled"`:
  //   https://huggingface.co/moonshotai/Kimi-K2.6
  {
    test: (id) => id.includes("kimi"),
    profile: {
      reasoning: true,
      toggleKey: "thinking",
      defaultOn: true,
      whenOn: { preserve_thinking: true },
      interleaved: true,
    },
  },
  // MiniMax-M2 / M3 — interleaved thinking, always on, no kwarg toggle (enabled
  // server-side via `--reasoning-parser minimax_m2`). The `minimax-m` prefix
  // covers the whole M-line (M2, M2.1, M2.5, M2.7, M3) without matching the
  // SynLogic models. verified:
  //   https://docs.vllm.ai/en/latest/features/interleaved_thinking/
  // M3 confirmed empirically on Featherless (2026-06-22): reasons by default on
  // the `reasoning` field; `enable_thinking` is a no-op (interleaved, not toggled).
  {
    test: (id) => id.includes("minimax-m"),
    profile: { reasoning: true, toggleKey: null, defaultOn: true, interleaved: true },
  },
  // Qwen3 *-Coder / *-Instruct variants don't reason — Qwen ships its Coder /
  // Instruct line as non-thinking BY DESIGN. This is Qwen-specific, NOT a general
  // "coding models can't reason" law (e.g. Kimi-K2-Code is thinking-only).
  // Confirmed for the 480B, 30B-A3B and Coder-Next variants in the catalog; the
  // only way to get CoT out of them is an unofficial system-prompt hack.
  // verified — the Coder card: "This model supports only non-thinking mode and
  // does not generate `<think></think>` blocks ... specifying enable_thinking=
  // False is no longer required":
  //   https://huggingface.co/Qwen/Qwen3-Coder-480B-A35B-Instruct
  //   https://huggingface.co/Qwen/Qwen3-Coder-Next/discussions/34 (the "enable
  //   reasoning" thread is a prompt-injection workaround, not a real toggle)
  {
    test: (id) => id.includes("qwen3") && (id.includes("coder") || id.includes("instruct")),
    profile: NON_REASONING,
  },
  // Small Qwen3.5 (2B/4B/9B) default to thinking off, but still interleave and
  // honor preserve_thinking like the rest of the 3.5 line. (Before the general
  // 3.5/3.6 rule, which they'd otherwise match.)
  // verified — "For Qwen3.5 0.8B, 2B, 4B and 9B, reasoning is disabled by
  // default": https://unsloth.ai/docs/models/qwen3.5
  {
    test: (id) =>
      id.includes("qwen3.5-2b") || id.includes("qwen3.5-4b") || id.includes("qwen3.5-9b"),
    profile: {
      reasoning: true,
      toggleKey: "enable_thinking",
      defaultOn: false,
      whenOn: { preserve_thinking: true },
      interleaved: true,
    },
  },
  // Qwen3.5 / 3.6 (incl. VL-Thinking) — enable_thinking, default on, interleaved,
  // PLUS a `preserve_thinking` kwarg (new in 3.5, same name as Kimi's) that retains
  // thinking across ALL history instead of only the latest user turn. The 3.6 card
  // recommends full retention "for agent scenarios". verified — Qwen3.6-35B-A3B
  // chat_template.jinja gates retention on `(preserve_thinking is defined and
  // preserve_thinking is true) or (loop.index0 > ns.last_query_index)`, and the
  // card: "only the thinking blocks generated in handling the latest user message
  // is retained, resulting in a pattern commonly as interleaved thinking":
  //   https://huggingface.co/Qwen/Qwen3.6-35B-A3B
  {
    test: (id) => id.includes("qwen3.5") || id.includes("qwen3.6"),
    profile: {
      reasoning: true,
      toggleKey: "enable_thinking",
      defaultOn: true,
      whenOn: { preserve_thinking: true },
      interleaved: true,
    },
  },
  // Qwen3 dedicated "-Thinking" variants (the 2507 split + multimodal line: e.g.
  // Qwen3-235B-A22B-Thinking-2507, Qwen3-30B-A3B-Thinking-2507, Qwen3-VL-235B-A22B-
  // Thinking) — ALWAYS on, NO `enable_thinking` toggle. Qwen dropped the hybrid
  // toggle for these and ships reasoning-only models that always emit a CoT (the
  // output carries only a closing `</think>`, no opening tag), parsed with
  // `deepseek_r1`. No `preserve_thinking` on this pre-3.5 line — resend
  // reasoning_content. (Before the generic qwen3 rule, but AFTER qwen3.5/3.6 so a
  // future 3.5+/-Thinking keeps the hybrid + preserve_thinking path.) verified — the
  // 2507 Thinking card: "This model supports only thinking mode" and "it is normal
  // for the model's output to contain only `</think>` without an explicit opening
  // `<think>` tag", deploy with `--reasoning-parser deepseek_r1`:
  //   https://huggingface.co/Qwen/Qwen3-235B-A22B-Thinking-2507
  {
    test: (id) => id.includes("qwen3") && id.includes("-thinking"),
    profile: { reasoning: true, toggleKey: null, defaultOn: true, interleaved: true },
  },
  // Original Qwen3 (8B / 30B-A3B / 235B-A22B) — enable_thinking, default on,
  // interleaved by the template's `last_query_index` "rolling checkpoint" (keeps
  // `<think>` only for turns after the last user message). No `preserve_thinking`
  // kwarg on this line — full-history retention arrived in 3.5; the caller must
  // resend reasoning_content on tool-call turns or there's nothing to retain.
  // verified — vLLM: "The reasoning feature for the Qwen3 series is enabled by
  // default. To disable it, you must pass `enable_thinking=False`" (parser `qwen3`;
  // the Qwen3-235B-A22B card example uses `deepseek_r1`):
  //   https://docs.vllm.ai/en/latest/features/reasoning_outputs/ — and the
  //   `ns.last_query_index` logic analyzed in the Qwen-3 chat-template deep-dive:
  //   https://huggingface.co/blog/qwen-3-chat-template-deep-dive
  {
    test: (id) => id.includes("qwen3"),
    profile: { reasoning: true, toggleKey: "enable_thinking", defaultOn: true, interleaved: true },
  },
  // Gemma 4 — enable_thinking, default OFF. (Also wants body
  // `skip_special_tokens:false` for clean parsing on some runtimes — not a
  // chat_template_kwarg.) verified — vLLM parser `gemma4`, thinking off unless
  // `enable_thinking=True`: https://docs.vllm.ai/en/latest/features/reasoning_outputs/
  {
    test: (id) => id.includes("gemma-4"),
    profile: { reasoning: true, toggleKey: "enable_thinking", defaultOn: false, interleaved: false },
  },
  // Xiaomi MiMo-V2 (Flash / V2.5) — `enable_thinking`, default OFF. verified
  // empirically on Featherless (2026-06-22): MiMo-V2-Flash emits nothing on the
  // `reasoning` field by default, and ~1.5k chars of reasoning once
  // `enable_thinking:true` is sent (`thinking` / `reasoning_effort` are no-ops).
  {
    test: (id) => id.includes("mimo"),
    profile: { reasoning: true, toggleKey: "enable_thinking", defaultOn: false, interleaved: false },
  },
  // OpenAI gpt-oss (20b / 120b) — harmony-format reasoner, ALWAYS on, no
  // chat_template_kwarg toggle (depth is set via `reasoning_effort` / a
  // "Reasoning: high" system line, not enable_thinking). verified empirically on
  // Featherless (2026-06-22): reasons on the `reasoning` field under every
  // kwarg combo. Like DeepSeek-R1/Step — inject nothing, just retain prior
  // reasoning. Parser `openai_gptoss`: https://docs.vllm.ai/en/latest/features/reasoning_outputs/
  {
    test: (id) => id.includes("gpt-oss"),
    profile: { reasoning: true, toggleKey: null, defaultOn: true, interleaved: false },
  },
  // StepFun Step-3.5 — reasons, but has NO documented kwarg toggle yet. verified
  // — maintainer in the HF thread: a disable switch is "coming next version"; the
  // only known workaround injects a `</think>` token. Treat as always-on:
  //   https://huggingface.co/stepfun-ai/Step-3.5-Flash/discussions/22
  {
    test: (id) => id.includes("step-3"),
    profile: { reasoning: true, toggleKey: null, defaultOn: true, interleaved: false },
  },
];

/**
 * Look up the {@link ReasoningProfile} for a model id, or `undefined` when no
 * family rule matches (unknown model — treat as non-reasoning).
 *
 * @param modelId - The model id, e.g. `"zai-org/GLM-5.1"`.
 * @returns The matched profile, or `undefined`.
 * @group Model
 */
export function reasoningProfileFor(modelId: string): ReasoningProfile | undefined {
  const id = modelId.toLowerCase();
  return RULES.find((rule) => rule.test(id))?.profile;
}

/**
 * Resolve the `chat_template_kwargs` to send for a model's thinking state, or
 * `undefined` to inject nothing (unknown / non-reasoning model, or an always-on
 * model with no toggle).
 *
 * @param modelId - The model id, e.g. `"deepseek-ai/DeepSeek-V4-Flash"`.
 * @param mode - Desired thinking state; defaults to `"auto"` (family default).
 * @returns The kwargs object to merge into the request body, or `undefined`.
 * @group Model
 */
export function reasoningKwargsFor(
  modelId: string,
  mode: ThinkingMode = "auto",
): Record<string, unknown> | undefined {
  const profile = reasoningProfileFor(modelId);
  if (!profile || !profile.reasoning) return undefined;

  const on = mode === "auto" ? profile.defaultOn : mode === "on";

  // No runtime toggle (always-on / interleaved): the only thing worth sending is
  // the continuity kwarg, and only while thinking is on.
  if (profile.toggleKey === null) {
    return on && profile.whenOn ? { ...profile.whenOn } : undefined;
  }

  const kwargs: Record<string, unknown> = { [profile.toggleKey]: on };
  if (on && profile.whenOn) Object.assign(kwargs, profile.whenOn);
  return kwargs;
}

/**
 * Merge the derived `chat_template_kwargs` into an OpenAI chat-completions
 * request body, keyed by its own `model` field. The seam a proxy uses to inject
 * thinking control without the client knowing the per-family dialect.
 *
 * Returns the body unchanged when it already carries an explicit
 * `chat_template_kwargs` (the caller's choice always wins), has no string
 * `model`, or the model is unknown/non-reasoning. Otherwise returns a shallow
 * copy with the kwargs added — the input is never mutated.
 *
 * @param body - The parsed request body.
 * @param mode - Desired thinking state; defaults to `"auto"` (family default).
 * @returns The body to forward upstream.
 * @group Model
 */
export function injectReasoningKwargs(
  body: Record<string, unknown>,
  mode: ThinkingMode = "auto",
): Record<string, unknown> {
  if (!body || typeof body !== "object" || "chat_template_kwargs" in body) return body;
  const model = typeof body.model === "string" ? body.model : undefined;
  if (!model) return body;
  const kwargs = reasoningKwargsFor(model, mode);
  return kwargs ? { ...body, chat_template_kwargs: kwargs } : body;
}
