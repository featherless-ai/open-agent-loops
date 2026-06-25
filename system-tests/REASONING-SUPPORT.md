# Reasoning / thinking support matrix

Per-model thinking flags for the 32 agentic reasoners in [`agentic-models.json`](agentic-models.json).
Use this to hand-verify each model's dialect against its primary doc.

**Source of truth:** [`agent-loop-core/providers/reasoning-kwargs.ts`](../agent-loop-core/providers/reasoning-kwargs.ts)
(`reasoningProfileFor()`). The JSON snapshot is asserted equal to it entry-by-entry
(toggle key, default, interleaved, continuity kwarg), so the table below is a faithful
projection of the source, and the source in turn carries a `verified:` link per rule.

**How "thinking" is wired (OpenAI-compatible / vLLM on Featherless):** thinking is
controlled by `chat_template_kwargs` in the request body. Two knobs per family:

- **Toggle key** — `enable_thinking` or `thinking` switches reasoning on/off. `null`
  means there is **no** toggle: the model always reasons (you cannot turn it off via a kwarg).
- **Continuity kwarg (when ON)** — whether the server *keeps prior-turn reasoning* you
  resend (`reasoning_content`). GLM uses `clear_thinking:false`; Kimi / Qwen3.5+ use
  `preserve_thinking:true`. Without it, families that default to clearing will drop the
  channel even if you resend it.

**Interleaved** = the model reasons *between* tool calls and the prior `<think>` should
be retained across tool-call turns. It is enabled by default (a server-side
`--reasoning-parser`, or the chat template's own `last_query_index` retention for Qwen3)
— **not** by the toggle kwarg. A family can be both interleaved *and* toggleable.

---

## Support matrix (32 models)

Legend — **Disable?**: ✅ = thinking can be turned off with the shown kwarg · ❌ = always
on, no kwarg toggle.  **Interleaved**: ✅ keep prior reasoning across tool calls · ❌ not interleaved.

| Model | Family | Thinking-ON `chat_template_kwargs` | Disable thinking? | Default | Interleaved | Aux flags | Ref |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `zai-org/GLM-5.2` | GLM | `enable_thinking:true, clear_thinking:false` | ✅ `enable_thinking:false` | on | ✅ | interleaved since GLM-4.5; `clear_thinking:false` = "Preserved Thinking" | [GLM card][glm] |
| `zai-org/GLM-5.1` | GLM | `enable_thinking:true, clear_thinking:false` | ✅ `enable_thinking:false` | on | ✅ | interleaved since GLM-4.5; `clear_thinking:false` = "Preserved Thinking" | [GLM card][glm] |
| `zai-org/GLM-5` | GLM | `enable_thinking:true, clear_thinking:false` | ✅ `enable_thinking:false` | on | ✅ | interleaved since GLM-4.5; `clear_thinking:false` = "Preserved Thinking" | [GLM card][glm] |
| `zai-org/GLM-4.7` | GLM | `enable_thinking:true, clear_thinking:false` | ✅ `enable_thinking:false` | on | ✅ | interleaved since GLM-4.5; `clear_thinking:false` = "Preserved Thinking" | [GLM card][glm] |
| `zai-org/GLM-4.7-Flash` | GLM | `enable_thinking:true, clear_thinking:false` | ✅ `enable_thinking:false` | on | ✅ | interleaved since GLM-4.5; `clear_thinking:false` = "Preserved Thinking" | [GLM card][glm] |
| `moonshotai/Kimi-K2.6` | Kimi | `thinking:true, preserve_thinking:true` | ✅ `thinking:false` | on | ✅ | parser `kimi_k2` | [Kimi K2.6 card][kimi] |
| `moonshotai/Kimi-K2.5` | Kimi | `thinking:true, preserve_thinking:true` | ✅ `thinking:false` | on | ✅ | parser `kimi_k2` | [Kimi K2.6 card][kimi] |
| `moonshotai/Kimi-K2-Thinking` | Kimi | — *(none; always on)* | ❌ always on | on | ✅ | dedicated reasoner; resend `reasoning_content` (no `preserve_thinking`); parser `kimi_k2` | [K2-Thinking card][kimi-think] |
| `MiniMaxAI/MiniMax-M2.7` | MiniMax | — *(none; always on)* | ❌ always on | on | ✅ | parser `minimax_m2` (server-side) | [vLLM interleaved][vllm-il] |
| `MiniMaxAI/MiniMax-M2.5` | MiniMax | — *(none; always on)* | ❌ always on | on | ✅ | parser `minimax_m2` (server-side) | [vLLM interleaved][vllm-il] |
| `MiniMaxAI/MiniMax-M2.1` | MiniMax | — *(none; always on)* | ❌ always on | on | ✅ | parser `minimax_m2` (server-side) | [vLLM interleaved][vllm-il] |
| `MiniMaxAI/MiniMax-M2` | MiniMax | — *(none; always on)* | ❌ always on | on | ✅ | parser `minimax_m2` (server-side) | [vLLM interleaved][vllm-il] |
| `deepseek-ai/DeepSeek-V4-Pro` | DeepSeek | `thinking:true` | ✅ `thinking:false` | off | ❌ | parser `deepseek_v3`; hosted-API alt† | [vLLM][vllm] |
| `deepseek-ai/DeepSeek-V4-Flash` | DeepSeek | `thinking:true` | ✅ `thinking:false` | off | ❌ | parser `deepseek_v3`; hosted-API alt† | [vLLM][vllm] |
| `deepseek-ai/DeepSeek-V3.2` | DeepSeek | `thinking:true` | ✅ `thinking:false` | off | ❌ | parser `deepseek_v3`; hosted-API alt† | [vLLM][vllm] |
| `deepseek-ai/DeepSeek-V3.2-Speciale` | DeepSeek | `thinking:true` | ✅ `thinking:false` | off | ❌ | parser `deepseek_v3`; hosted-API alt† | [vLLM][vllm] |
| `deepseek-ai/DeepSeek-V3.1` | DeepSeek | `thinking:true` | ✅ `thinking:false` | off | ❌ | parser `deepseek_v3`; hosted-API alt† | [vLLM][vllm] |
| `deepseek-ai/DeepSeek-V3.1-Terminus` | DeepSeek | `thinking:true` | ✅ `thinking:false` | off | ❌ | parser `deepseek_v3`; hosted-API alt† | [vLLM][vllm] |
| `deepseek-ai/DeepSeek-R1-0528` | DeepSeek | — *(none; always on)* | ❌ always on | on | ❌ | parser `deepseek_r1` | [vLLM][vllm] |
| `Qwen/Qwen3.5-397B-A17B` | Qwen | `enable_thinking:true, preserve_thinking:true` | ✅ `enable_thinking:false` | on | ✅ | `preserve_thinking` ⇒ full retention | [Qwen3.6 card][qwen36] |
| `Qwen/Qwen3-235B-A22B` | Qwen | `enable_thinking:true` | ✅ `enable_thinking:false` | on | ✅ | parser `qwen3`; `last_query_index`‡ | [vLLM][vllm] |
| `Qwen/Qwen3-VL-235B-A22B-Thinking` | Qwen | — *(none; always on)* | ❌ always on | on | ✅ | dedicated reasoner ("only thinking mode"); parser `deepseek_r1`; `</think>`-only output | [Qwen3-Thinking-2507 card][qwen-think] |
| `Qwen/Qwen3.6-35B-A3B` | Qwen | `enable_thinking:true, preserve_thinking:true` | ✅ `enable_thinking:false` | on | ✅ | `preserve_thinking` ⇒ full retention | [Qwen3.6 card][qwen36] |
| `Qwen/Qwen3.6-27B` | Qwen | `enable_thinking:true, preserve_thinking:true` | ✅ `enable_thinking:false` | on | ✅ | `preserve_thinking` ⇒ full retention | [Qwen3.6 card][qwen36] |
| `Qwen/Qwen3.5-27B` | Qwen | `enable_thinking:true, preserve_thinking:true` | ✅ `enable_thinking:false` | on | ✅ | `preserve_thinking` ⇒ full retention | [Qwen3.6 card][qwen36] |
| `Qwen/Qwen3.5-9B` | Qwen | `enable_thinking:true, preserve_thinking:true` | ✅ `enable_thinking:false` | off | ✅ | small line defaults off | [Unsloth Qwen3.5][unsloth] |
| `Qwen/Qwen3.5-4B` | Qwen | `enable_thinking:true, preserve_thinking:true` | ✅ `enable_thinking:false` | off | ✅ | small line defaults off | [Unsloth Qwen3.5][unsloth] |
| `Qwen/Qwen3.5-2B` | Qwen | `enable_thinking:true, preserve_thinking:true` | ✅ `enable_thinking:false` | off | ✅ | small line defaults off | [Unsloth Qwen3.5][unsloth] |
| `google/gemma-4-31B-it` | Gemma | `enable_thinking:true` | ✅ `enable_thinking:false` | off | ❌ | parser `gemma4`; body `skip_special_tokens:false`§ | [vLLM][vllm] |
| `google/gemma-4-26B-A4B-it` | Gemma | `enable_thinking:true` | ✅ `enable_thinking:false` | off | ❌ | parser `gemma4`; body `skip_special_tokens:false`§ | [vLLM][vllm] |
| `stepfun-ai/Step-3.7-Flash` | Step | — *(none; always on)* | ❌ always on¶ | on | ❌ | no toggle documented yet | [Step thread][step] |
| `stepfun-ai/Step-3.5-Flash` | Step | — *(none; always on)* | ❌ always on¶ | on | ❌ | no toggle documented yet | [Step thread][step] |

### Footnotes

- **† DeepSeek hosted-API alt** — these are the *open-weights / vLLM* numbers (Featherless serves
  them this way): `thinking` chat_template_kwarg, **default OFF**. DeepSeek's own hosted API uses a
  different surface — `extra_body={"thinking":{"type":"enabled"}}`, **default enabled** — not this
  kwarg. ([DeepSeek thinking-mode docs][ds-api])
- **‡ `last_query_index`** — original Qwen3 has no `preserve_thinking` kwarg; the chat template keeps
  `<think>` only for turns *after the last user message* (a rolling checkpoint), so the caller must
  resend `reasoning_content` on tool-call turns or there is nothing to retain. Full-history retention
  arrived with the `preserve_thinking` kwarg in 3.5.
- **§ Gemma `skip_special_tokens:false`** — a top-level body field (not a `chat_template_kwarg`) some
  runtimes want for clean `<think>` parsing.
- **¶ Step "always on"** — no documented disable kwarg yet (maintainer: "coming next version"); the
  only known workaround injects a `</think>` token. Treat as always-on.

---

## Per-family notes & sources

Each block quotes the primary doc the rule is drawn from, so a row can be checked end-to-end.

### GLM (5.2 / 5.1 / 5 / 4.7 / 4.7-Flash)
- **Toggle** `enable_thinking` · **continuity** `clear_thinking:false` · **default ON** · **interleaved**.
- **Interleaved**: "Interleaved Thinking" was introduced **since GLM-4.5** — the model "thinks between
  tool calls and after receiving tool results", so prior reasoning must be retained across tool-call
  turns. GLM-4.7 enhanced it with **Preserved Thinking** (`clear_thinking:false`, retain thinking
  across turns) and **Turn-level Thinking** (per-turn enable/disable).
- The GLM-4.7 card shows the exact agentic combo `{enable_thinking:true, clear_thinking:false}` and
  "thinking mode is enabled by default". Newer GLM (5.1 / 5.2) **clear by default**, which is why the
  explicit `clear_thinking:false` is the load-bearing part — older GLM (5 / 4.7) preserve by default.
- Sources: [GLM-4.7 card][glm] · [Z.AI thinking-mode guide][zai] · [`clear_thinking` = "preserved thinking" (Together)][together]

### Kimi — hybrid line (K2.6 / K2.5)
- **Toggle** `thinking` · **continuity** `preserve_thinking:true` · **default ON** · interleaved · parser `kimi_k2`.
- K2.6 card: think mode = `{thinking:True, preserve_thinking:True}`, instant mode = `{thinking:False}`,
  "enable `preserve_thinking` only in think mode"; thinking on by default. The Kimi platform guide
  confirms k2.5 / k2.6 accept `thinking.type:"disabled"` (so they *can* be turned off).
- Sources: [Kimi-K2.6 card][kimi] · [Kimi platform thinking guide][kimi-platform]

### Kimi — dedicated reasoner (K2-Thinking)
- **No toggle** (always on) · interleaved · parser `kimi_k2` · **resend-only** (no `preserve_thinking`).
- K2-Thinking has no instant mode and no disable kwarg — it is "end-to-end trained to interleave
  chain-of-thought reasoning with function calls". It shares the *interleaved / multi-step tool-call*
  design with the hybrid line (resend `reasoning_content` within a task) but **not** the
  `preserve_thinking` full-history switch, which the K2.5/K2.6 line added (cf. original Qwen3 vs 3.5).
  The platform guide lists `thinking.type:"disabled"` only for k2.5/k2.6/k2.7-code — not k2-thinking.
- ⚠️ The *always-on* classification is well-evidenced; the *no-`preserve_thinking`* part is inferred by
  parallel to original Qwen3 — worth a live check if it matters.
- Sources: [Kimi-K2-Thinking card][kimi-think] · [Kimi platform thinking guide][kimi-platform]

(Note: `Kimi-K2-Instruct` is the *non-reasoning* line and is intentionally excluded from this list.)

### MiniMax (M2.7 / M2.5 / M2.1 / M2)
- **No toggle** (always on) · interleaved · enabled server-side via `--reasoning-parser minimax_m2`.
  No `chat_template_kwarg` to inject — the caller's only job is to retain prior reasoning.
- Source: [vLLM interleaved thinking][vllm-il]

### DeepSeek V (V4-Pro / V4-Flash / V3.2 / V3.2-Speciale / V3.1 / V3.1-Terminus)
- **Toggle** `thinking` · **default OFF** on open-weights · no continuity kwarg (resend
  `reasoning_content`) · not interleaved.
- vLLM: "reasoning is disabled by default; to enable it, you must also pass `thinking=True` in your
  `chat_template_kwargs`" (parser `deepseek_v3`). See footnote † for the hosted-API difference.
- Sources: [vLLM reasoning outputs][vllm] · [DeepSeek hosted thinking mode][ds-api]

### DeepSeek R1 (R1-0528)
- **No toggle** (always reasons) · not interleaved · parser `deepseek_r1` extracts reasoning automatically.
- Source: [vLLM reasoning outputs][vllm]

### Qwen3 — original hybrid (Qwen3-235B-A22B)
- **Toggle** `enable_thinking` · **default ON** · interleaved via the template's `last_query_index`
  rolling checkpoint · **no** `preserve_thinking` on this line (see footnote ‡).
- vLLM: "The reasoning feature for the Qwen3 series is enabled by default. To disable it, you must pass
  `enable_thinking=False`" (parser `qwen3`; the Qwen3-235B-A22B card example uses `deepseek_r1`). The
  rolling-checkpoint retention is dissected in the Qwen-3 chat-template deep-dive.
- Sources: [vLLM reasoning outputs][vllm] · [Qwen-3 chat-template deep-dive][qwen-tmpl]

### Qwen3 — dedicated Thinking variants (Qwen3-VL-235B-A22B-Thinking)
- **No toggle** (always on) · interleaved · parser `deepseek_r1` · **resend-only** (no `preserve_thinking`).
- The 2507 split (and the multimodal `-Thinking` line) abandoned the hybrid toggle: these are
  reasoning-only models. The 2507 card states **"This model supports only thinking mode"** and "it is
  normal for the model's output to contain only `</think>` without an explicit opening `<think>` tag".
  Same era as original Qwen3, so no `preserve_thinking` — resend `reasoning_content`.
- ⚠️ The *always-on* classification follows the documented 2507 `-Thinking` pattern; the VL-Thinking
  card itself is terse, so confirm with a live check if it matters.
- Source: [Qwen3-235B-A22B-Thinking-2507 card][qwen-think]

### Qwen3.5 / 3.6 (Qwen3.5-397B-A17B, Qwen3.6-35B-A3B, Qwen3.6-27B, Qwen3.5-27B)
- **Toggle** `enable_thinking` · **continuity** `preserve_thinking:true` · **default ON** · interleaved.
- `preserve_thinking` (new in 3.5, same name as Kimi's) retains thinking across **all** history instead
  of only the latest user turn; the 3.6 card recommends full retention "for agent scenarios". The
  Qwen3.6-35B-A3B `chat_template.jinja` gates retention on `(preserve_thinking is defined and
  preserve_thinking is true) or (loop.index0 > ns.last_query_index)`.
- Source: [Qwen3.6-35B-A3B card][qwen36]

### Qwen3.5 — small (Qwen3.5-9B, 4B, 2B)
- Same dialect as the 3.5 line (`enable_thinking` + `preserve_thinking`, interleaved) but **default OFF**.
- "For Qwen3.5 0.8B, 2B, 4B and 9B, reasoning is disabled by default."
- Sources: [Unsloth Qwen3.5][unsloth] · [Qwen3.6-35B-A3B card][qwen36]

### Gemma 4 (gemma-4-31B-it, gemma-4-26B-A4B-it)
- **Toggle** `enable_thinking` · **default OFF** · not interleaved · parser `gemma4`. Some runtimes
  also want body `skip_special_tokens:false` for clean parsing (footnote §).
- Source: [vLLM reasoning outputs][vllm]

### Step (Step-3.7-Flash, Step-3.5-Flash)
- Reasons, **always on** — no documented disable kwarg yet (footnote ¶).
- Maintainer in the HF thread: a disable switch is "coming next version"; the only known workaround
  injects a `</think>` token.
- Source: [Step-3.5-Flash discussion][step]

---

## References

- **vLLM — Reasoning Outputs** (parser names + per-family defaults): <https://docs.vllm.ai/en/latest/features/reasoning_outputs/>
- **vLLM — Interleaved Thinking**: <https://docs.vllm.ai/en/latest/features/interleaved_thinking/>
- **GLM-4.7 model card**: <https://huggingface.co/zai-org/GLM-4.7>
- **Z.AI — thinking-mode guide** (GLM interleaved/preserved thinking): <https://docs.z.ai/guides/capabilities/thinking-mode>
- **Together — reasoning / `clear_thinking`**: <https://docs.together.ai/docs/inference/chat/reasoning>
- **Kimi-K2.6 model card**: <https://huggingface.co/moonshotai/Kimi-K2.6>
- **Kimi-K2-Thinking model card**: <https://huggingface.co/moonshotai/Kimi-K2-Thinking>
- **Kimi platform — thinking-model guide**: <https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model>
- **Qwen3.6-35B-A3B model card**: <https://huggingface.co/Qwen/Qwen3.6-35B-A3B>
- **Qwen3-235B-A22B-Thinking-2507 model card** (dedicated Thinking variant): <https://huggingface.co/Qwen/Qwen3-235B-A22B-Thinking-2507>
- **Qwen-3 chat-template deep-dive** (rolling checkpoint / `last_query_index`): <https://huggingface.co/blog/qwen-3-chat-template-deep-dive>
- **Unsloth — Qwen3.5 docs**: <https://unsloth.ai/docs/models/qwen3.5>
- **DeepSeek — thinking mode (hosted API)**: <https://api-docs.deepseek.com/guides/thinking_mode>
- **Step-3.5-Flash — disable-thinking discussion**: <https://huggingface.co/stepfun-ai/Step-3.5-Flash/discussions/22>

<!-- reference-link definitions used by the table/notes above -->
[vllm]: https://docs.vllm.ai/en/latest/features/reasoning_outputs/
[vllm-il]: https://docs.vllm.ai/en/latest/features/interleaved_thinking/
[glm]: https://huggingface.co/zai-org/GLM-4.7
[zai]: https://docs.z.ai/guides/capabilities/thinking-mode
[together]: https://docs.together.ai/docs/inference/chat/reasoning
[kimi]: https://huggingface.co/moonshotai/Kimi-K2.6
[kimi-think]: https://huggingface.co/moonshotai/Kimi-K2-Thinking
[kimi-platform]: https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model
[qwen36]: https://huggingface.co/Qwen/Qwen3.6-35B-A3B
[qwen-think]: https://huggingface.co/Qwen/Qwen3-235B-A22B-Thinking-2507
[qwen-tmpl]: https://huggingface.co/blog/qwen-3-chat-template-deep-dive
[unsloth]: https://unsloth.ai/docs/models/qwen3.5
[ds-api]: https://api-docs.deepseek.com/guides/thinking_mode
[step]: https://huggingface.co/stepfun-ai/Step-3.5-Flash/discussions/22
