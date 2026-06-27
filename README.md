<a href="https://featherless.ai">
  <img src="./assets/banner.svg" alt="Open Agent Loops — from 0 to a prototype agent in a few lines of code" width="100%" />
</a>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="https://openagentloops.featherless.ai/docs/">Documentation</a> ·
  <a href="./examples">Examples</a> ·
  <a href="./examples/kitchen-sink-web">Kitchen-sink demo</a> ·
  <a href="https://discord.gg/7gybCMPjVA">Discord</a>
</p>

<p align="center">
  <!-- npm badges — enable once @open-agent-loops/core is published to npm:
  <a href="https://www.npmjs.com/package/@open-agent-loops/core"><img alt="npm version" src="https://img.shields.io/npm/v/@open-agent-loops/core?logo=npm&color=facc15" /></a>
  <a href="https://www.npmjs.com/package/@open-agent-loops/core"><img alt="npm downloads" src="https://img.shields.io/npm/dw/@open-agent-loops/core?logo=npm" /></a>
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

Prerequisites: [Node 20.6+](https://nodejs.org) (for `--env-file`) and an
OpenAI-compatible endpoint (Featherless, vLLM, Together, Groq, …).

Install the package, its peer (`openai`), and `zod`. `tsx` runs the `.ts` files
below without a build step:

```sh
npm install @open-agent-loops/core openai zod
npm install -D tsx
```

> [!NOTE]
> `@open-agent-loops/core` isn't published to npm yet. Until it is,
> clone this repo and run the examples with [Bun](https://bun.sh)
> (`bun run examples/<name>/<name>.ts`, which auto-loads `.env`) — the source
> below is identical apart from the import paths.

Create a `.env` next to your script:

```sh
LLM_API_KEY=sk-...            # API key for the endpoint
LLM_MODEL=zai-org/GLM-5.2     # model id to call
# LLM_BASE_URL defaults to https://api.featherless.ai/v1 — point it at any OpenAI-compatible endpoint
```

### Single-turn loop — one prompt, one answer

A local `weather` tool, a typed `render` over every `AgentEvent`, and the prompt
read from the terminal. Save as `single-turn-loop.ts`:

```ts
import { AgentEventType, defineTool, runAgent, SessionMemoryStore } from "@open-agent-loops/core";
import type { AgentEvent } from "@open-agent-loops/core";
import { OpenAICompatibleModel } from "@open-agent-loops/core/providers/openai";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { z } from "zod";

const weather = defineTool({
  name: "weather",
  description: "Get the current weather for a city.",
  parameters: z.object({ city: z.string().describe("City to look up.") }),
  execute: async ({ city }) => {
    // Replace with a real API call to fetch the weather.
    return { content: `Sunny in ${city}` };
  },
});

// Batteries included: the OpenAI-compatible client, pointed at any endpoint.
const model = new OpenAICompatibleModel({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
  model: process.env.LLM_MODEL ?? "zai-org/GLM-5.2",
  thinking: "on", // stream the reasoning channel so `render` actually shows it
});

// `onEvent` is your renderer. The loop is headless and emits a typed AgentEvent
// stream — `render` handles every event that flows through the loop.
function render(e: AgentEvent) {
  switch (e.type) {
    case AgentEventType.AgentStart:
      console.log(`▶ start · session ${e.sessionId}`);
      break;
    case AgentEventType.TurnStart:
      console.log(`\n— turn ${e.step} —`);
      break;
    case AgentEventType.ReasoningDelta:
      // The reasoning channel — dim it so it reads as distinct from the answer.
      process.stdout.write(`\x1b[2m${e.text}\x1b[22m`);
      break;
    case AgentEventType.TextDelta:
      process.stdout.write(e.text);
      break;
    case AgentEventType.Message:
      console.log(`\n· ${e.message.role} message complete`);
      break;
    case AgentEventType.ToolStart:
      console.log(`→ ${e.toolName}(${JSON.stringify(e.args)})`);
      break;
    case AgentEventType.ToolEnd:
      console.log(`← ${e.toolName} [${e.isError ? "error" : "ok"}]: ${e.result}`);
      break;
    case AgentEventType.AgentEnd:
      console.log(`\n■ done · ${e.steps} steps`);
      break;
  }
}

// Read the question from the terminal — type "What's the weather in Paris?".
const rl = createInterface({ input, output });
const prompt = await rl.question("you › ");
rl.close();

const result = await runAgent({
  model,
  memory: new SessionMemoryStore(), // batteries-included in-memory conversation store
  sessionId: "single-turn-demo",
  prompt,
  tools: [weather],
  onEvent: render,
});

console.log(`\n${result.messages.at(-1)?.content}`);
```

Run it (`--env-file` loads your `.env`):

```sh
npx tsx --env-file=.env single-turn-loop.ts
```

### Multi-turn chat — remembers every prior turn

The same `runAgent` call, wrapped in a read-input loop that reuses one `memory`
+ `sessionId`, so every turn sees the ones before it. Save as `multi-turn-chat.ts`:

```ts
import { AgentEventType, defineTool, runAgent, SessionMemoryStore } from "@open-agent-loops/core";
import type { AgentEvent } from "@open-agent-loops/core";
import { OpenAICompatibleModel } from "@open-agent-loops/core/providers/openai";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { z } from "zod";

const apiKey = process.env.LLM_API_KEY;
const modelId = process.env.LLM_MODEL;
if (!apiKey || !modelId) {
  console.error("Set LLM_API_KEY and LLM_MODEL (see .env above).");
  process.exit(1);
}

const weather = defineTool({
  name: "weather",
  description: "Get the current weather for a city.",
  parameters: z.object({ city: z.string().describe("City to look up.") }),
  execute: async ({ city }) => {
    // Replace with a real API call to fetch the weather.
    return { content: `Sunny in ${city}` };
  },
});

const model = new OpenAICompatibleModel({
  apiKey,
  model: modelId,
  baseURL: process.env.LLM_BASE_URL ?? "https://api.featherless.ai/v1",
  thinking: "on", // stream the reasoning channel so `render` actually shows it
});

// The same renderer as the single-turn loop — it handles every event the loop emits.
function render(e: AgentEvent) {
  switch (e.type) {
    case AgentEventType.AgentStart:
      console.log(`▶ start · session ${e.sessionId}`);
      break;
    case AgentEventType.TurnStart:
      console.log(`\n— turn ${e.step} —`);
      break;
    case AgentEventType.ReasoningDelta:
      // The reasoning channel — dim it so it reads as distinct from the answer.
      process.stdout.write(`\x1b[2m${e.text}\x1b[22m`);
      break;
    case AgentEventType.TextDelta:
      process.stdout.write(e.text);
      break;
    case AgentEventType.Message:
      console.log(`\n· ${e.message.role} message complete`);
      break;
    case AgentEventType.ToolStart:
      console.log(`→ ${e.toolName}(${JSON.stringify(e.args)})`);
      break;
    case AgentEventType.ToolEnd:
      console.log(`← ${e.toolName} [${e.isError ? "error" : "ok"}]: ${e.result}`);
      break;
    case AgentEventType.AgentEnd:
      console.log(`\n■ done · ${e.steps} steps`);
      break;
  }
}

const memory = new SessionMemoryStore(); // one store, reused every turn
const sessionId = "chat"; //               same id every turn → one conversation
const rl = createInterface({ input, output });

while (true) {
  const prompt = (await rl.question("\nyou › ")).trim();
  if (prompt === "" || prompt === "exit") break;

  process.stdout.write("bot › ");
  await runAgent({ model, memory, sessionId, prompt, tools: [weather], onEvent: render });
}
rl.close();
```

Run it, then ask a follow-up ("and in London?") to see it carry context across
turns. Type `exit` or an empty line to quit:

```sh
npx tsx --env-file=.env multi-turn-chat.ts
```

More examples (steering, console formatting) live in [`examples/`](./examples).

## Documentation

📖 **Read the docs online:**
<https://openagentloops.featherless.ai/docs/>

The full documentation is a [fumadocs](https://fumadocs.dev) site under
[`docs-fuma/`](./docs-fuma), published to GitHub Pages on every push to `main`
(see [`.github/workflows/deploy-docs.yml`](./.github/workflows/deploy-docs.yml)).
To run it locally:

```sh
cd docs-fuma
bun install        # first time only
bun run dev
```

Then open <http://localhost:3000/docs>. (From the repo root, `bun run docs:site`
does the same.)
