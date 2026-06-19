# Single-turn agent loop

One prompt, one answer. A local `weather` tool, a typed `render` over every
`AgentEvent`, and the prompt read from the terminal.

## Run

```bash
cp .env.example .env   # at the repo root; fill in LLM_API_KEY and LLM_MODEL
bun run examples/single-turn-loop/single-turn-loop.ts
```

At the `you ›` prompt, type something like `What's the weather in Paris?`.

`LLM_BASE_URL` defaults to `https://api.featherless.ai/v1`; set it to point at
any OpenAI-compatible endpoint.
