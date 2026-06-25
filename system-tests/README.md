# system-tests

**Live** tests that hit real models on Featherless (`LLM_API_KEY` required). These
are deliberately kept out of `agent-loop-core/__tests__` (the offline, mocked unit
suite) and out of the shipped package — `package.json` ships `files: ["dist"]`
only, and the `tsup` build bundles just the library entry points, so nothing here
is published.

## Files

- **`reasoning-number-test.ts`** — runnable harness for the "number test": plant a
  secret only in a prior turn's reasoning channel, then check whether the model can
  recall it (proving the reasoning round-trips). Not a `*.test.ts`, so `bun test`
  ignores it; run it directly. Prints a per-model × off/on/preserve/clear table,
  grouped by family.
- **`agentic-models.json`** — the curated list of the 32 reasoning-capable agentic
  models (id + family + a snapshot of each one's catalog reasoning dialect: toggle,
  default, interleaved, continuity kwarg), sourced from the feather-app launch-agent
  dropdown. The harness reads this.
- **`REASONING-SUPPORT.md`** — hand-verifiable support matrix for those 32 models: every
  thinking flag (toggle / continuity / auxiliary), whether thinking can be turned off,
  and whether it's interleaved — each row cross-checked against `reasoning-kwargs.ts` and
  cited to its primary doc (vLLM / HF card).
- **`reasoning-asymmetry.test.ts`** — gated `bun:test` that asserts the GLM
  reasoning-field asymmetry (preserve recalls; clear / off do not). Skipped unless
  opted in, so it's safe in any `bun test` run.

## Running

```bash
# The number-test harness (default preset = `latest`):
bun run number-test
MODELS=agentic REPS=3 CONC=8 bun run system-tests/reasoning-number-test.ts
MODELS="zai-org/GLM-5.2" bun run system-tests/reasoning-number-test.ts

# The gated assertion test (opt-in; skipped without LIVE_REASONING=1):
LIVE_REASONING=1 bun run test:system
LIVE_REASONING=1 LIVE_REASONING_MODEL=zai-org/GLM-5 LIVE_REASONING_REPS=3 bun test system-tests
```

`LLM_API_KEY` / `LLM_BASE_URL` come from `.env`. Presets: `latest` (newest reasoner
per family, incl. MiMo + gpt-oss) and `agentic` (all 32 dropdown reasoners). Pass a
comma list for an explicit set.
