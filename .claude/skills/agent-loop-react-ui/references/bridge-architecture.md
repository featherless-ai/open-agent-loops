# Bridge architecture — Layer B (durable, you generate)

The bridge is framework-agnostic TypeScript that depends **only** on
`@open-agent-loops/core`. It turns the loop's `AgentEvent` stream into something
a UI can render, and it survives UI-library churn untouched. Two pieces, both
shipped as copy-paste assets in `../assets/bridge/`:

| File | Role | Status |
|---|---|---|
| `assets/bridge/agent-snapshot.ts` | the reducer: `AgentEvent` → `AgentSnapshot` | **tested** (`agent-snapshot.test.ts`, end-to-end against a real `runAgent`) |
| `assets/bridge/sse-stream.ts` | server transport: stream snapshots as SSE | reasoned, web-standard; not browser-run |

Copy these into the consumer's project and adapt; don't reinvent them.

## The reducer accumulates; it does not buffer

A snapshot is **read once per render** (repeatedly), so the reducer folds deltas
with plain string concatenation:

```ts
case AgentEventType.TextDelta:      current.text += event.text; break;
case AgentEventType.ReasoningDelta: current.reasoning += event.text; break;
```

`current` is the in-flight assistant turn (reset at each `turn_start`); `messages`
is the committed log (from `message` events); tool calls are joined across
`tool_start`/`tool_end` by `toolCallId`. See the file for the full `AgentSnapshot`
shape.

**Do not put a `BoundedBuffer` in the reducer.** A capacity-1 coalesce buffer is
*consume-once* (you `drain()` it), but a snapshot is read many times — you'd never
drain it, so it'd be the wrong tool. The reducer *is* the accumulator.

## Where coalescing actually lives: the flush, not the fold

This is the crux of the "fps" question, resolved correctly:

- **The fold** (accumulate deltas into state) → the reducer. Always.
- **The flush trigger** (decide *when* to emit/repaint) → **host-owned**, never in
  core. A terminal owns a frame clock (~30fps); a web SSE transport owns a
  `setInterval`; a React runtime lets React schedule; a channel flushes at the
  turn boundary. Same fold, different clock.
- **`BoundedBuffer` cap-1 coalesce** → reach for it **only** when forwarding
  *deltas* to a rate-limited sink and you must fold many deltas into one payload
  between flushes. That is exactly what `ChannelBridge` does for Slack/Discord
  (study it). A *snapshot* transport doesn't need it, because the reducer already
  accumulated and you send the whole snapshot per frame.

`sse-stream.ts` shows the snapshot-transport pattern: reducer accumulates, a
~30fps `setInterval` flushes when `dirty`, and **structural events flush eagerly**
(`tool_start`/`tool_end`/`message`/`agent_end`) so ordering and responsiveness
never wait behind the delta clock.

## Two ways to drive the reducer

1. **Server (production)** — `runAgentSSE({ run: { model, memory, sessionId, prompt, tools } })`
   returns a `Response` streaming snapshot frames. Keeps your API key off the
   client. Web-standard, so it runs on Bun/Deno/Node 18+/edge.
2. **Client-only (demo / no backend)** — feed the reducer directly from a
   client-side `runAgent` driven by `MockModelClient`
   (`@open-agent-loops/core/mocks/mock-model`). Zero network, zero key — perfect
   for building the UI first. This is what the assistant-ui example does.

## Push → pull

`runAgent` is push-based (`onEvent` callback fires during the run); React adapters
are pull-based (an `async *run()` generator). Bridge them with a tiny async queue
that turns `onEvent` calls into an `AsyncIterable<AgentEvent>` — see
`eventChannel()` in `../assets/assistant-ui/src/agent-adapter.tsx`. The SSE
transport doesn't need this (it enqueues straight into the `ReadableStream`).

## Invariant

The bridge never imports a UI library, and a UI component never imports
`runAgent`. The reducer and transport sit between them. If either import shows up
across that line, a layer leaked — and you've re-coupled the durable code to the
churny code, which is the one thing this whole structure exists to prevent.
