# Open Agent OS

A minimal, provider-agnostic **agentic loop**. The whole point of this package
is to make the components of the agent **plug-and-play, independently testable, and reliable** — every fundamental thing sits behind an interface, so it can be
swapped without touching the loop.

One runtime dependency (`zod`, for tool schemas). Everything else is plain
hand-written TypeScript — no platform APIs, so the same ESM build runs in
**Node, Bun, Deno, and the browser**.

```sh
npm install agent-core        # or: bun add / deno add npm:agent-core
```

## The seams

| Seam           | Interface       | v1 implementation             | Swap in later                 |
| -------------- | --------------- | ----------------------------- | ----------------------------- |
| LLM boundary   | `ModelClient`   | `MockModelClient`             | OpenAI-compatible / Anthropic |
| Memory         | `Memory`        | `SessionMemoryStore`          | JSONL file / Redis / vector   |
| Capabilities   | `Tool`          | `defineTool(...)`             | any tool you write            |
| Stopping       | `StopCondition` | `maxSteps`, `whenToolCalled`  | custom predicates             |

The loop (`runAgent`) only ever depends on these interfaces. Models **stream by
default** — `ModelClient.stream()` returns an async iterable of `StreamEvent`s.

```
load history → append prompt → ┌─ stream assistant turn
                               │   any tool calls? ─ no → final answer ✓
                               │        │ yes
                               │   run tools → append results
                               └── repeat (until terminate / stopWhen / maxSteps)
```

## Usage

```ts
import { runAgent, SessionMemoryStore, defineTool, AgentEventType } from "agent-core";
// MockModelClient is a test double, not part of the public surface:
import { MockModelClient } from "agent-core/mocks/mock-model";
import { z } from "zod";

const weather = defineTool({
  name: "weather",
  description: "Get weather for a city",
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => {
    // Replace with a real API call to fetch the weather.
    return { content: `Sunny in ${city}` };
  },
});

// In production, pass your own ModelClient instead of this test double.
const model = new MockModelClient([
  { toolCalls: [{ name: "weather", arguments: { city: "Paris" } }] },
  { text: "It's sunny in Paris." },
]);

const result = await runAgent({
  model,
  memory: new SessionMemoryStore(),
  sessionId: "demo",
  prompt: "What's the weather in Paris?",
  tools: [weather],
  // onEvent is your renderer: the loop is headless and only emits a typed
  // AgentEvent stream. Render it anywhere — stdout here, the DOM in a browser,
  // a TUI, a log sink.
  onEvent: (e) => {
    if (e.type === AgentEventType.TextDelta) process.stdout.write(e.text);
    else if (e.type === AgentEventType.ToolStart) console.log(`→ ${e.toolName}`, e.args);
  },
});

console.log(result.messages.at(-1)?.content); // "It's sunny in Paris."
```

## Bring your own renderer

The loop is **headless** — it never writes to a screen. It emits a typed
`AgentEvent` stream (`onEvent`), and the model emits `StreamEvent`s; *you* decide
how to present them. The `onEvent` handler above is a renderer — swap stdout for
DOM nodes in the browser, React state, a TUI, or a log sink without touching the
loop. For ready-made timeline/trajectory rendering, point a `Tracer` at the same
events.

## Adding a real model client

Batteries included for OpenAI-compatible endpoints: import `OpenAICompatibleModel`
from the opt-in `agent-core/providers/openai` subpath (kept out of the core entry
so importing `agent-core` never pulls the `openai` SDK into a browser bundle).
Install the optional peer — `npm install openai` — and point it anywhere:

```ts
import { OpenAICompatibleModel } from "agent-core/providers/openai";

const model = new OpenAICompatibleModel({
  model: "deepseek-ai/DeepSeek-V3.1",
  baseURL: "https://api.featherless.ai/v1",
  apiKey: process.env.FEATHERLESS_API_KEY,
});
```

Or roll your own — implement the one method, `stream()`. Map `req.messages`/
`req.tools` to your provider's API, then translate its chunks into `StreamEvent`s
(`text_delta` / `tool_call` / `done`). In the browser, point this at your own
backend proxy instead of embedding a key.

```ts
import type { ModelClient, ModelRequest, StreamEvent } from "agent-core";

export class MyModel implements ModelClient {
  async *stream(req: ModelRequest): AsyncGenerator<StreamEvent> {
    // call your provider, then yield { type: "text_delta" | "tool_call" | "done" }
  }
}
```

## Develop

```sh
bun install
bun test         # run the suite (deterministic, zero network)
bun run typecheck
bun run demo     # run examples/running-product.ts against a real model (needs .env)
```

The loop, memory, tools, and stop conditions are all verified against the
streaming `MockModelClient` — see [`agent-core/`](./agent-core) and its
[README](./agent-core/README.md) / [architecture docs](./agent-core/docs/architecture.md).
