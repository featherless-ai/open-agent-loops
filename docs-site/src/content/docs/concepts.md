---
title: Concepts
description: How the loop, events, hooks, tools, and composition fit together.
---

This page is the mental model. For exact signatures, see the
[API reference](/api/).

## Composition over inheritance

Every piece sits behind an interface that you satisfy with a plain
object/function, then optionally wrap with a decorator (the `with*` helpers) —
never subclassed. The four interfaces you implement or supply:

- **`ModelClient`** — the LLM boundary (implement `{ stream }`).
- **`Memory`** — conversation storage (use `SessionMemoryStore`, or your own).
- **`Tool`** — a callable capability (author with `defineTool`, which infers
  argument types from the Zod schema).
- **`StopCondition`** — when to end a run (compose with `any` / `all` / `not`).

## Events

A run emits an `AgentEvent` stream for observability and UI streaming. Each event
is a discriminated union tagged by `AgentEventType`:

- `agent_start` / `agent_end` — run boundaries.
- `turn_start` — a new model turn.
- `reasoning_delta` / `text_delta` — streamed chunks of the assistant's
  reasoning and text channels.
- `message` — a complete message was appended.
- `tool_start` / `tool_end` — a tool call's lifecycle, with its arguments and
  result.

Every event carries a `timestamp` stamped centrally at emit time, so you can
measure latency between turns, tokens, and tool calls.

## Hooks

Hooks are the seam for guardrails and context shaping. They run at fixed points
in a turn:

- **`transformContext`** — reshape history right before it is sent to the model.
  This is where long-horizon context management lives (compaction, note-taking,
  tool-result clearing).
- **`gateToolCalls`** — admit or block the turn's tool calls *as a batch*,
  before any execute. This is where permission prompting belongs (see
  [Getting started](/getting-started/#gating-tool-calls-permissions)).
- **`beforeToolCall`** / **`afterToolCall`** — inspect/block a call before it
  runs, and inspect/override its result after.

## Tools

A tool bundles a `name`, a `description`, a Zod schema for its arguments, and an
`execute` handler. The loop validates arguments against the schema *before*
calling `execute`, so handlers can trust their input. Both the `description` and
each schema field's `.describe()` flow into the JSON Schema the model sees — so
documenting a tool well directly improves how the model uses it.

Tools default to **parallel** execution within a turn; set
`executionMode: ExecutionMode.Sequential` to force one-at-a-time.

Use a `ToolRegistry` to keep a named catalog and resolve subsets by name (the
workflow seam needs name → tool resolution because authored workflow code is a
string).

## Stop conditions

A run ends when the model returns a final answer, a tool sets `terminate`, or a
`StopCondition` fires. Combinators let you build predicates declaratively:

```ts
import { runAgent, maxSteps, whenToolCalled, any } from "~/agent-core";

await runAgent({
  // ...
  stopWhen: any(maxSteps(8), whenToolCalled("submit")),
});
```

## Composition decorators

The `with*` helpers wrap a seam to add behavior without changing its callers:

- **`withModelObserver`** — tap a `ModelClient`'s stream for logging/metrics.
- **`withMemoryNamespace`** — scope a `Memory` to a key prefix.
- **`withMemoryListeners`** — react to memory reads/writes.
- **`withCredentials`** — substitute secret placeholders into tool arguments on
  the way in and scrub them out of results on the way out.
