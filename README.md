<a href="https://featherless.ai">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/banner-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="./assets/banner.svg" />
    <img src="./assets/banner.svg" alt="Open Agent Loops — from 0 to a prototype agent in a few lines of code" width="100%" />
  </picture>
</a>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="./examples">Examples</a> ·
  <a href="./examples/kitchen-sink-web">Kitchen-sink demo</a> ·
  <a href="https://discord.gg/7gybCMPjVA">Discord</a>
</p>

<p align="center">
  <!-- npm badges — enable once @open-agent-loops/agent-loop-core is published to npm:
  <a href="https://www.npmjs.com/package/@open-agent-loops/agent-loop-core"><img alt="npm version" src="https://img.shields.io/npm/v/@open-agent-loops/agent-loop-core?logo=npm&color=facc15" /></a>
  <a href="https://www.npmjs.com/package/@open-agent-loops/agent-loop-core"><img alt="npm downloads" src="https://img.shields.io/npm/dw/@open-agent-loops/agent-loop-core?logo=npm" /></a>
  -->
  <img alt="Built with Bun" src="https://img.shields.io/badge/Built%20with-Bun-000?logo=bun&logoColor=fff" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=fff" />
  <img alt="OpenAI-compatible" src="https://img.shields.io/badge/API-OpenAI--compatible-412991?logo=openai&logoColor=fff" />
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-facc15" />
  <a href="https://discord.gg/7gybCMPjVA"><img alt="Discord — Featherless AI" src="https://img.shields.io/badge/Discord-Featherless%20AI-5865F2?logo=discord&logoColor=fff" /></a>
</p>

<p align="center">
  <b>From 0 to a prototype agent in a few lines of code. 🧰⚡</b>
</p>

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
