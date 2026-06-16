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
 * | Kimi K2 Thinking  | `thinking`       | `preserve_thinking: true`   |
 * | DeepSeek V3.1/V4  | `thinking`       | (resend reasoning_content)  |
 * | Qwen3 / Gemma 4   | `enable_thinking`| —                           |
 *
 * Some families have no runtime toggle: DeepSeek R1 and StepFun Step-3.5 always
 * reason, and MiniMax-M2 does *interleaved* thinking (enabled server-side via
 * vLLM's `--reasoning-parser`, not a kwarg). For those, {@link reasoningKwargsFor}
 * injects nothing — the caller's job is only to RETAIN prior reasoning across
 * tool-call turns, which the loop's `prepareRequestMessages` already does.
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
   * is no runtime toggle (always-on reasoners like DeepSeek R1, and interleaved
   * models like MiniMax-M2).
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
   * it is enabled server-side, not via kwargs — the caller must keep prior
   * reasoning in the message history rather than strip it.
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
  // GLM 4.7 / 5 / 5.1 — enable_thinking + clear_thinking continuity, default on.
  // verified — the GLM-4.7 card shows the exact agentic combo
  // `{enable_thinking:true, clear_thinking:false}` and "thinking mode is enabled
  // by default": https://huggingface.co/zai-org/GLM-4.7  (clear_thinking =
  // "preserved thinking" also documented at
  // https://docs.together.ai/docs/inference/chat/reasoning)
  {
    test: (id) => id.includes("glm-"),
    profile: {
      reasoning: true,
      toggleKey: "enable_thinking",
      defaultOn: true,
      whenOn: { clear_thinking: false },
      interleaved: false,
    },
  },
  // Kimi K2 *-Instruct is the non-reasoning line. (Before the generic Kimi rule.)
  // verified — the card: "It is a reflex-grade model without long thinking":
  //   https://huggingface.co/moonshotai/Kimi-K2-Instruct
  { test: (id) => id.includes("kimi-k2-instruct"), profile: NON_REASONING },
  // Kimi K2 Thinking / K2.5 / K2.6 — `thinking` toggle + preserve_thinking (only
  // while on), interleaved. verified — the K2.6 card: think mode =
  // `chat_template_kwargs {thinking:True, preserve_thinking:True}`, instant mode
  // = `{thinking:False}`, "enable preserve_thinking only in think mode":
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
  // MiniMax-M2 — interleaved thinking, always on, no kwarg toggle (enabled
  // server-side via `--reasoning-parser minimax_m2`). verified:
  //   https://docs.vllm.ai/en/latest/features/interleaved_thinking/
  {
    test: (id) => id.includes("minimax-m2"),
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
  // Small Qwen3.5 (2B/4B/9B) default to thinking off.
  // verified — "For Qwen3.5 0.8B, 2B, 4B and 9B, reasoning is disabled by
  // default": https://unsloth.ai/docs/models/qwen3.5
  {
    test: (id) =>
      id.includes("qwen3.5-2b") || id.includes("qwen3.5-4b") || id.includes("qwen3.5-9b"),
    profile: { reasoning: true, toggleKey: "enable_thinking", defaultOn: false, interleaved: false },
  },
  // Qwen3 / 3.5 / 3.6 hybrids (incl. VL-Thinking) — enable_thinking, default on.
  // verified — vLLM: "The reasoning feature for the Qwen3 series is enabled by
  // default. To disable it, you must pass `enable_thinking=False`" (parser
  // `qwen3`): https://docs.vllm.ai/en/latest/features/reasoning_outputs/
  {
    test: (id) => id.includes("qwen3"),
    profile: { reasoning: true, toggleKey: "enable_thinking", defaultOn: true, interleaved: false },
  },
  // Gemma 4 — enable_thinking, default OFF. (Also wants body
  // `skip_special_tokens:false` for clean parsing on some runtimes — not a
  // chat_template_kwarg.) verified — vLLM parser `gemma4`, thinking off unless
  // `enable_thinking=True`: https://docs.vllm.ai/en/latest/features/reasoning_outputs/
  {
    test: (id) => id.includes("gemma-4"),
    profile: { reasoning: true, toggleKey: "enable_thinking", defaultOn: false, interleaved: false },
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
