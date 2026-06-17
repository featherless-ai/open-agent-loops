# Open Agent OS

A minimal, provider-agnostic agentic loop. Every fundamental piece sits behind
an interface so it can be swapped without touching the loop — the point of this
package is to make the **components of the agent plug-and-play, independently testable, and reliable**.

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
loop. For ready-made timeline/trajectory rendering, point a [`Tracer`](#tracing-a-run-debugging)
at the same events.

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
} from "agent-core";
import type { ApprovalPrompter } from "agent-core";

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
import type { ModelClient, ModelRequest, StreamEvent } from "agent-core";

export class MyModel implements ModelClient {
  async *stream(req: ModelRequest): AsyncGenerator<StreamEvent> {
    // map req.messages/tools → your API, then translate its streamed chunks
    // into { type: "text_delta" } / { type: "tool_call" } / { type: "done" }.
  }
}
```

Or skip the boilerplate: `OpenAICompatibleModel` from the opt-in
`agent-core/providers/openai` subpath implements `stream()` against any
OpenAI-compatible endpoint (install the optional `openai` peer). It's a separate
subpath so importing `agent-core` never pulls the SDK into a browser bundle.

## Tracing a run (debugging)

`Tracer` is a passive observer that records the run as a timestamped timeline,
built on the existing seams — it never touches the loop. Tap one or more of:

- `tracer.sink` → `runAgent({ onEvent })` — the agent events (the trajectory),
  plus the **system prompt** and **available tools** (the loop puts them on the
  `agent_start` event, so the sink alone captures them — no extra wiring)
- `tracer.observe(model)` — wrap a `ModelClient` to also capture its
  `StreamEvent`s, and pull system + tool specs off each request into `meta`
- `tracer.onRequest` → `OpenAICompatibleModel({ onRequest })` — records the
  **model id**, **sampling params**, and **system prompt** into `meta`
- `tracer.onRawSSE` → `OpenAICompatibleModel({ onRawSSE })` — raw wire lines

Two logging paths: **`log`** is synchronous (called inline per entry — use it
only for cheap sinks like an array or `console.log`); **`write`** is the
async, queued, batched path for real I/O — lines are buffered and flushed on a
microtask off the agent loop's hot path (fire-and-forget), with block-until-
drained backpressure when the queue fills. The queue **auto-drains on
`agent_end`** — the loop awaits that event, so `runAgent` resolves only once the
trace is fully written and you never have to call `flush()` yourself (set
`flushOnEnd: false` to manage it manually, or call `flush()` for non-loop use).

```ts
import { Tracer } from "agent-core";
import { OpenAICompatibleModel } from "agent-core/providers/openai";
import { appendFile } from "node:fs/promises";

// Async, batched, off the hot path. Flush once when the run ends.
const tracer = new Tracer({ write: (lines) => appendFile("trace.jsonl", lines.join("\n") + "\n") });

const model = new OpenAICompatibleModel({
  model, baseURL, apiKey,
  params: { temperature: 0.2 },
  onRequest: tracer.onRequest,   // capture model + params + system
  onRawSSE: tracer.onRawSSE,     // capture raw SSE lines
});

await runAgent({
  model: tracer.observe(model),  // capture model-boundary stream events too
  memory, sessionId, system, prompt, tools,
  onEvent: tracer.sink,          // capture the agent's events
});
// async write queue auto-drains on agent_end — no manual flush() needed

console.log(tracer.format());            // timestamped timeline (with meta header)
console.log(tracer.formatTrajectory());  // per-turn (action → observation) pairs
const doc = tracer.toJSON();             // { meta, startedAt, durationMs, entries } — one document
const jsonl = tracer.toJSONL();          // entries only, one JSON object per line
```

JSON output uses a **compact** shape (`CompactEntry`): the event payload is
flattened up and the redundant fields dropped — `label` (always `data.type`) and
the absolute `t` (kept as relative `dt`; absolute time is `startedAt + dt`).
A line reads `{"seq":2,"dt":7,"source":"agent","type":"turn_start","step":1}` —
~25% smaller than the in-memory entry, which stays rich for programmatic use.

`meta` records the run's config — `model`, `params`, `system`, `tools` (full
specs), `sessionId` — so a saved trace is reproducible; `format()` /
`formatTrajectory()` print it as a header (tools listed with their descriptions).

### Progressive disclosure (over time)

`observe()` snapshots every per-turn `ModelRequest`, so you can watch what's
disclosed to the model evolve across the run. `disclosure()` diffs consecutive
snapshots — tools added/removed and how the context window grew — and
`formatDisclosure()` renders it:

```
disclosure · 3 turns
  turn 1 (+0ms)  tools[1]: search +search                      ctx=1 (+1)
  turn 2 (+0ms)  tools[2]: search, open_file +open_file        ctx=2 (+1)
  turn 3 (+0ms)  tools[3]: search, open_file, deploy +deploy   ctx=3 (+1)
```

Note: `runAgent` sends a **fixed tool set** for a run, so within one run the
tool surface doesn't change — what discloses progressively is the **context**
(messages accumulate, `transformContext` reshapes it). The tool diff lights up
when the surface genuinely varies — a custom `ModelClient` that reveals tools
on demand, or a future per-turn tool hook. `trajectory()` folds the run
into one `(assistant action → tool observations)` pair per turn, with per-tool
and per-turn durations — the view you usually read when debugging. `format()`
interleaves every source (agent / model / sse) into a single ordered timeline.
Capture is best-effort and non-throwing: a tracer never breaks the run it
observes. Pass `{ now }` to inject a clock and `{ limit }` for a ring buffer.

## Tests

```bash
bun test agent-core      # or: bun run test
```

Every suite covers a base case plus edge cases. The loop, memory, tools, and
stop conditions are all verified with the streaming `MockModelClient` — zero
network, fully deterministic.
