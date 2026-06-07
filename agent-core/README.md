# Open Agent OS

A minimal, provider-agnostic agentic loop. Every fundamental piece sits behind
an interface so it can be swapped without touching the loop — the point of this
package is to make the **core things plug-and-play and independently testable**.

## The seams

| Seam          | Interface      | v1 implementation        | Swap in later                   |
| ------------- | -------------- | ------------------------ | ------------------------------- |
| LLM boundary  | `ModelClient`  | `MockModelClient`        | OpenAI-compatible / Anthropic   |
| Memory        | `Memory`       | `SessionMemoryStore`     | JSONL file / Redis / vector     |
| Capabilities  | `Tool`         | `defineTool(...)`        | any tool you write              |
| Stopping      | `StopCondition`| `maxSteps`, `whenToolCalled` | custom predicates          |

The loop (`runAgent`) only ever depends on these interfaces. Models **stream by
default** — `ModelClient.stream()` returns an async iterable of `StreamEvent`s.

> **Architecture diagram:** see [`docs/architecture.md`](./docs/architecture.md)
> (Mermaid, renders on GitHub).

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
import { runAgent, SessionMemoryStore, defineTool } from "~/agent-core";
// MockModelClient is a test double, not part of the public surface:
import { MockModelClient } from "~/agent-core/mocks/mock-model";
import { z } from "zod";

const weather = defineTool({
  name: "weather",
  description: "Get weather for a city",
  parameters: z.object({ city: z.string() }),
  execute: ({ city }) => ({ content: `Sunny in ${city}` }),
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
  onEvent: (e) => console.log(e.type),
});

console.log(result.messages.at(-1)?.content); // "It's sunny in Paris."
```

## Gating tool calls (permissions)

The whole turn's tool calls arrive together, so admission is a **batch** concern.
The `gateToolCalls` hook runs once per turn — serially, *before* the parallel
execution phase — and returns one decision per call. Denied calls never run; they
become error tool-results the model can react to. Because gating happens in this
single up-front phase, an interactive permission prompt never races the parallel
tool execution.

`permissionGate` implements the hook as an allow / deny / **ask** policy from two
small seams: a `PermissionStore` (the config the loop reads, and where "always"
choices are persisted) and an `ApprovalPrompter` (how you ask the user when the
policy is "ask").

```ts
import {
  runAgent,
  permissionGate,
  InMemoryPermissionStore,
  PermissionPolicy,
  ApprovalChoice,
} from "~/agent-core";
import type { ApprovalPrompter } from "~/agent-core";

// Config: read tool policies from anywhere. Ask means prompt the user.
const store = new InMemoryPermissionStore({
  fallback: PermissionPolicy.Ask,
  rules: { read_file: PermissionPolicy.Allow, deploy: PermissionPolicy.Deny },
});

// CLI prompter: present the pending calls and return a choice each.
const prompter: ApprovalPrompter = {
  async ask(batch) {
    // ApprovalChoice: AllowOnce | AllowAlways | DenyOnce | DenyAlways
    return batch.map(() => ApprovalChoice.AllowOnce);
  },
};

await runAgent({
  /* model, memory, sessionId, prompt, tools, */
  hooks: { gateToolCalls: permissionGate(store, prompter) },
});
```

An `allow_always` / `deny_always` choice is written back to the store, so the
next run — even a fresh CLI process backed by a JSON-file store — won't ask
again. Swap `InMemoryPermissionStore` for a file-backed store to make decisions
durable across runs.

## Adding a real model client

Implement the one method — `stream()`. Map `req.messages`/`req.tools` to your
provider's API, then translate its chunks into `StreamEvent`s. Any
OpenAI-compatible endpoint works with a raw `fetch`; no extra package needed.

```ts
import type { ModelClient, ModelRequest, StreamEvent } from "~/agent-core";

export class MyModel implements ModelClient {
  async *stream(req: ModelRequest): AsyncGenerator<StreamEvent> {
    // map req.messages/tools → your API, then translate its streamed chunks
    // into { type: "text_delta" } / { type: "tool_call" } / { type: "done" }.
  }
}
```

## Tests

```bash
bun test agent-core      # or: bun run test
```

Every suite covers a base case plus edge cases. The loop, memory, tools, and
stop conditions are all verified with the streaming `MockModelClient` — zero
network, fully deterministic.
