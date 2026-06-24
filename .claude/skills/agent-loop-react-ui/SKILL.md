---
name: agent-loop-react-ui
description: Build an agent + orchestrator on @open-agent-loops/core and wire it to a React-like chat UI (assistant-ui, or any AI-chat React library). Use this whenever the user wants to put an agent on a web front end, build a chat UI for an agent loop, stream an agent to the browser, plug agent-loop-core into React/assistant-ui, render reasoning/tool-calls in a UI, or "give my agent a frontend" — even if they don't name the library. Generates the architecturally-correct bridge (event→snapshot reducer, transport, thin UI adapter) and verifies the front-end API against live docs first, because those libraries churn.
---

# Agent-Loop → React-like UI

You are wiring an **agent loop** to a **rendering surface**. The whole design of `@open-agent-loops/core` rests on one line: **the core emits a typed event stream and never renders.** Rendering is host-binding, so it lives outside the framework — which means *you generate the bridge*, the framework does not ship it.

Your job is to produce the architecturally-correct glue and let the UI library render it — **not** to paste a frozen example. The UI libraries in this space (assistant-ui especially) change their runtime/adapter APIs often, so a snapshot of "here's the code" rots. Instead: hold the architecture fixed, regenerate the churny layer against current docs.

## The core principle

```
 agent-loop-core            YOUR BRIDGE                 UI library
┌────────────────┐   ┌────────────────────────┐   ┌──────────────┐
│ runAgent emits │──▶│ AgentEvent → snapshot   │──▶│ React renders│
│  AgentEvent[]  │   │ reducer + transport     │   │  the snapshot│
└────────────────┘   └────────────────────────┘   └──────────────┘
   (never renders)     (you generate this)          (off the shelf)
```

Three layers, and **only the last one is allowed to know which UI library you're using.** That isolation is the entire point: when assistant-ui ships a breaking change, you regenerate one thin file.

## HARD GATE — before writing any code

> 1. **Verify the real exports.** Read `references/primitives-map.md`, then confirm the symbols you plan to import actually exist in the installed package (`node_modules/@open-agent-loops/core` or the local `agent-loop-core/index.ts`). This package moves — directories get renamed, exports get added. Never import from memory; grep the index.
> 2. **Verify the UI library's current API.** Read `references/assistant-ui.md` for the architecture, but its concrete API names are **date-stamped and will drift**. Before writing the Layer-C adapter, fetch the live docs (WebFetch/WebSearch the library's runtime + tool-UI pages) and confirm the hook names, adapter shapes, and tool-UI registration. As of this writing `makeAssistantToolUI` is already deprecated — assume anything specific has changed.
> 3. **Design the three layers separately.** If your plan collapses the bridge into the UI component (e.g. parsing `AgentEvent`s inside a React component, or putting `runAgent` behind the UI library's "model adapter" with no snapshot reducer), stop — you've coupled the churny layer to the durable one. Keep B and C distinct.

Skipping the gate produces code that imports symbols that don't exist and calls UI APIs that were renamed two releases ago. The verification costs two tool calls and saves a debugging spiral.

## The three layers

### Layer A — Agent + Orchestrator (from exports)

Assemble from the published surface; nothing here is novel. See `references/primitives-map.md` for the full inventory and import paths. The shape:

- **Agent**: `runAgent({ model, memory, sessionId, prompt, tools, onEvent })`. Model via `OpenAICompatibleModel` (server) or `MockModelClient` (UI-without-backend). Memory via `SessionMemoryStore`. Tools via `defineTool` + `ToolRegistry`.
- **Orchestrator** — pick one composition over `runAgent` (none touch the loop):
  - `runGoal` + `modelGrader` — outer loop, re-prompt until a goal is graded done.
  - `agentAsTool` — wrap specialists as tools a parent agent routes to, in one chat.
  - `Dispatcher` / `ChannelBridge` — many concurrent sessions with backpressure.

Choose by the problem (see selection table below), state the choice, move on. This layer is well-documented; the difficulty is never here.

### Layer B — the durable bridge (you generate; low churn)

Framework-agnostic TypeScript that depends only on `@open-agent-loops/core` — survives UI-library churn untouched. **Shipped as tested copy-paste assets** (see "Copy-paste assets" below). Read `references/bridge-architecture.md` for the why. Two pieces:

1. **`createSnapshotReducer()` — the reducer** (`assets/bridge/agent-snapshot.ts`). Folds the `AgentEvent` stream into a serializable `AgentSnapshot`: the committed messages, the in-flight assistant turn, reasoning, tool calls joined by `toolCallId`, and status. It **accumulates with plain concatenation** — a snapshot is read every render, so don't put a consume-once `BoundedBuffer` (or a timer) in here.
2. **A transport** (`assets/bridge/sse-stream.ts`). Server: `runAgentSSE(...)` streams snapshots as web-standard SSE (keeps your key off the client). Client-only demo: skip the wire and feed the reducer from a `MockModelClient` run directly.

### Layer C — the UI-library adapter (you generate; high churn — verify first)

The *only* file that imports the UI library. It maps your snapshot to whatever the library currently wants. For assistant-ui that's a runtime hook + a converter + tool-UI registrations. **These names change** — confirm them against live docs (gate step 2) before writing. `references/assistant-ui.md` has the current-as-of-date mapping and the doc URLs.

## Invariants (why the bridge is shaped this way)

- **Accumulate deltas into state; don't repaint per token.** The reducer folds `text_delta` / `reasoning_delta` into accumulated text — a model streams far faster than any surface needs repainting. (`BoundedBuffer` cap-1 coalesce is the SDK's tool for the *different* job of folding deltas into one payload when forwarding to a rate-limited sink — see `ChannelBridge`; a snapshot transport doesn't need it.)
- **The flush trigger is host-owned, never in core.** Who decides "now repaint"? A terminal owns a frame clock (~30fps); a web runtime lets React schedule; a channel flushes at the turn boundary. Same coalescer, different trigger. Putting a timer in the bridge couples it to one host — keep the clock at the edge.
- **UI runtimes want accumulated snapshots, not deltas.** Most React AI runtimes (assistant-ui's streaming adapter included) expect each update to carry the *full* state so far, and do their own diffing. Your reducer already produces accumulated state — yield that. Sending deltas to a snapshot-shaped API is the most common integration bug.
- **Structural events flush eagerly.** `tool_start` / `tool_end` / `message` should surface immediately, not wait behind the delta coalescer — ordering and responsiveness depend on it. The clock only governs the delta firehose.
- **The core never imports the UI library, and the UI component never imports `runAgent`.** If either happens, a layer leaked.

## Selection — orchestrator

| Problem shape | Use |
|---|---|
| "Keep working until the goal is met / self-correct" | `runGoal` + `modelGrader` |
| "One assistant that delegates to specialists in one chat" | `agentAsTool` (specialists as tools) |
| "Many users / threads at once, live transport" | `Dispatcher` → `ChannelBridge` |
| "Single request → answer" | plain `runAgent` (no orchestrator) |

## Selection — UI runtime (assistant-ui)

| Need | Runtime | Note |
|---|---|---|
| Quickest path, messages only | `useLocalRuntime` + a `ChatModelAdapter` | adapter is `async *run()` yielding **accumulated** content |
| You own message state (redux/zustand/etc.) | `useExternalStoreRuntime` | supply `convertMessage` |
| Stream **full agent state** (reasoning, tools, custom panels) | AssistantTransport | best fit for this SDK's structured stream; backend streams snapshots, client supplies a `converter` |

Default to AssistantTransport when the UI needs more than chat bubbles (tool cards, reasoning, app state) — it's the closest match to "core emits structured state." Re-verify its hook/option names against live docs before coding.

## AgentEvent → UI mapping

| `AgentEvent` | UI meaning |
|---|---|
| `agent_start` | new run; mark running; carries `system`, `tools` |
| `turn_start` | new model turn (step index) |
| `reasoning_delta` | append to the reasoning channel (coalesce) |
| `text_delta` | append to assistant text (coalesce) |
| `message` | a complete message landed (flush eagerly) |
| `tool_start` | render a tool call as in-flight (`toolCallId`, `toolName`, `args`) |
| `tool_end` | resolve that tool call (`result`, `isError`) — generative tool UI |
| `message_injected` | a steering/follow-up message entered mid-run |
| `agent_end` | run finished; clear running; `steps` total |

The `toolCallId` on `tool_start`/`tool_end` is the join key — pair them to drive a tool's running→complete UI.

## Anti-patterns

| ❌ Don't | ✅ Do |
|---|---|
| Import SDK symbols from memory | Grep `agent-loop-core/index.ts` first (gate step 1) |
| Write the assistant-ui adapter from memory | Fetch live docs first (gate step 2); APIs churn |
| Parse `AgentEvent`s inside a React component | Reduce to a snapshot in Layer B; the component reads state |
| Hand-roll an fps throttle / `setInterval` in the bridge | Coalesce with `BoundedBuffer`; let the host own the flush clock |
| Yield deltas to a snapshot-shaped runtime | Yield accumulated snapshots (Layer B already produces them) |
| `runAgent` imported by the UI component | Keep `runAgent` server/transport-side; component reads the snapshot |
| Treat the baked assistant-ui example as evergreen | It's pinned + dated — re-verify Layer C against current docs (the bridge is frozen; Layer C is not) |
| Skip the bridge, point the UI's "model adapter" straight at `runAgent` | Reducer in the middle, so reasoning/tools/state survive |

## Output contract

When you finish, the user gets:

1. **File tree** — the Layer A/B/C files with absolute paths, labeled by layer.
2. **Architecture sketch** — 3–5 bullets: which orchestrator, which runtime, where the reducer lives, where the flush clock is owned.
3. **What was verified live** — name the SDK exports you grepped and the UI-library doc pages you fetched (with the date), so the user knows the churny layer is current.
4. **Run it** — exact commands (server + client), and the mock-model path for running the UI with no backend/key.
5. **Where to change things** — "swap the UI library → rewrite only `<Layer-C file>`; everything else is untouched."

## Copy-paste assets

The skill ships working starting points — copy them into the consumer's project rather than re-deriving:

| Asset | Layer | Status |
|---|---|---|
| `assets/bridge/agent-snapshot.ts` | B — reducer | **tested** end-to-end vs a real `runAgent` (`agent-snapshot.test.ts`) |
| `assets/bridge/sse-stream.ts` | B — transport | web-standard SSE; reasoned, not browser-run |
| `assets/assistant-ui/` | C — UI adapter | pinned `@assistant-ui/react@0.14.23`, no-backend demo; **re-verify before use** |

Freeze Layer B; treat Layer C as a pinned, dated scaffold you re-verify. The bridge imports only `@open-agent-loops/core` — zero React — so it never adds a runtime dep to the consumer's agent code.

## Reference files

| File | Load when |
|---|---|
| `references/primitives-map.md` | Assembling Layer A — exports, signatures, import paths |
| `references/bridge-architecture.md` | Writing Layer B — the reducer + transport recipe |
| `references/assistant-ui.md` | Writing Layer C — current API map + the docs to re-verify |
