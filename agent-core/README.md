# Lightweight agent core

A minimal, provider-agnostic agentic loop. Every fundamental piece sits behind
an interface so it can be swapped without touching the loop — the point of this
package is to make the **core things plug-and-play and independently testable**.

## The seams

| Seam          | Interface      | v1 implementation        | Swap in later                   |
| ------------- | -------------- | ------------------------ | ------------------------------- |
| LLM boundary  | `ModelClient`  | `FakeModelClient`        | OpenAI-compatible / Anthropic   |
| Memory        | `Memory`       | `InMemoryStore`          | JSONL file / Redis / vector     |
| Capabilities  | `Tool`         | `defineTool(...)`        | any tool you write              |
| Stopping      | `StopCondition`| `maxSteps`, `whenToolCalled` | custom predicates          |

The loop (`runAgent`) only ever depends on these interfaces. Models **stream by
default** — `ModelClient.stream()` returns an async iterable of `StreamEvent`s.

> **Architecture diagram:** see [`docs/architecture.md`](./docs/architecture.md)
> (Mermaid, renders on GitHub), or run the docs app (`npm run dev`) and open
> `/architecture` for the interactive Vue Flow version.

## The loop

```
load history → append prompt → ┌─ stream assistant turn
                               │   any tool calls? ─ no → final answer ✓
                               │        │ yes
                               │   run tools → append results
                               └── repeat (until terminate / stopWhen / maxSteps)
```

## Usage

```ts
import { runAgent, InMemoryStore, FakeModelClient, defineTool } from "~/agent-core";
import { z } from "zod";

const weather = defineTool({
  name: "weather",
  description: "Get weather for a city",
  parameters: z.object({ city: z.string() }),
  execute: ({ city }) => ({ content: `Sunny in ${city}` }),
});

// Swap FakeModelClient for a real OpenAI-compatible client in production.
const model = new FakeModelClient([
  { toolCalls: [{ name: "weather", arguments: { city: "Paris" } }] },
  { text: "It's sunny in Paris." },
]);

const result = await runAgent({
  model,
  memory: new InMemoryStore(),
  sessionId: "demo",
  prompt: "What's the weather in Paris?",
  tools: [weather],
  onEvent: (e) => console.log(e.type),
});

console.log(result.messages.at(-1)?.content); // "It's sunny in Paris."
```

## Adding a real model client

Implement the one method. Sketch over the deps already in this repo
(`ai` + `@ai-sdk/openai-compatible`, pointed at Featherless):

```ts
import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelClient, ModelRequest, StreamEvent } from "~/agent-core";

export class FeatherlessModel implements ModelClient {
  async *stream(req: ModelRequest): AsyncGenerator<StreamEvent> {
    // map req.messages/tools → AI SDK, then translate its fullStream chunks
    // into { type: "text_delta" } / { type: "tool_call" } / { type: "done" }.
  }
}
```

## Tests

```bash
bun test agent-core      # or: bun run test
```

Every suite covers a base case plus edge cases. The loop, memory, tools, and
stop conditions are all verified with the streaming `FakeModelClient` — zero
network, fully deterministic.
