# Open Agent Loops

A minimal, provider-agnostic **agentic loop**. The whole point of this package
is to make the components of the agent **plug-and-play, independently testable, and reliable** — every fundamental thing sits behind an interface, so it can be
swapped without touching the loop.

## Quickstart

Prerequisites: [Bun](https://bun.sh) and an OpenAI-compatible endpoint
(Featherless, vLLM, Together, Groq, …).

```sh
cp .env.example .env   # then fill in LLM_API_KEY and LLM_MODEL
```

`LLM_BASE_URL` defaults to `https://api.featherless.ai/v1`; point it at any
OpenAI-compatible endpoint. Bun auto-loads `.env`.

**Single-turn loop** — one prompt, one answer:

```sh
bun run examples/single-turn-loop/single-turn-loop.ts
```

Type something like `What's the weather in Paris?` at the `you ›` prompt.

**Multi-turn chat** — reuses one `memory` + `sessionId`, so every turn remembers
the ones before it:

```sh
bun run examples/multi-turn-chat/multi-turn-chat.ts
```

Chat at the `you ›` prompt and ask a follow-up to see it carry context across
turns. Type `exit` or an empty line to quit.

More examples (steering, console formatting) live in [`examples/`](./examples).

## Documentation

The full documentation is a [fumadocs](https://fumadocs.dev) site under
[`docs-fuma/`](./docs-fuma). To run it locally:

```sh
cd docs-fuma
bun install        # first time only
bun run dev
```

Then open <http://localhost:3000/docs>. (From the repo root, `bun run docs:site`
does the same.)
