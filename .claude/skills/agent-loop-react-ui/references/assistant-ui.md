# assistant-ui mapping — Layer C (churny, verify before use)

> **Date-stamped: June 2026, `@assistant-ui/react@0.14.23`.** This is the one
> layer that rots. `makeAssistantToolUI` was already deprecated. **Before writing
> the adapter, fetch the live docs and confirm the names below.** If something
> here doesn't match the docs, the docs win.
>
> Docs to re-verify (WebFetch/WebSearch):
> - Runtime pick: <https://www.assistant-ui.com/docs/runtimes/pick-a-runtime>
> - LocalRuntime / ChatModelAdapter: <https://www.assistant-ui.com/docs/runtimes/custom/local-runtime>
> - ExternalStore: <https://www.assistant-ui.com/docs/runtimes/custom/external-store>
> - AssistantTransport: <https://www.assistant-ui.com/docs/runtimes/assistant-transport>
> - Tool UI: <https://www.assistant-ui.com/docs/tools/tool-ui>

A complete, pinned, copy-paste example lives in `../assets/assistant-ui/`
(no-backend, runs on the MockModelClient). Start there; this file is the *why*.

## Pick a runtime

| Need | Runtime | Key fact |
|---|---|---|
| Quickest, messages only | `useLocalRuntime(adapter)` | adapter is `async *run()` — see streaming rule below |
| You own message state (redux/zustand/tanstack) | `useExternalStoreRuntime({ messages, isRunning, convertMessage, onNew })` | `convertMessage(yourMsg) => ThreadMessageLike` |
| Stream **full agent state** (reasoning, tools, panels) | AssistantTransport (`useAssistantTransportRuntime({ api, initialState, converter })`) | backend streams state snapshots; client supplies a `converter` |

For this SDK, **AssistantTransport is the philosophical match** — our stream is
structured state, not just chat text, and the snapshot reducer already produces a
whole-state object. Use LocalRuntime for the fast first cut (the bundled example),
graduate to AssistantTransport when the UI needs tool cards + reasoning + app
state.

## The streaming rule (verified verbatim)

The LocalRuntime `ChatModelAdapter` is an async generator, and:

> **"Each yield replaces the previous content. Yield the full state every time,
> not deltas."**

```ts
const adapter: ChatModelAdapter = {
  async *run({ messages, abortSignal /*, context */ }) {
    let text = "";
    for await (const part of stream) {
      text += part.delta;                       // accumulate
      yield { content: [{ type: "text", text }] }; // yield ACCUMULATED, not the delta
    }
  },
};
```

This is why the bridge reducer accumulates: its `snapshot().current.text` is
already the full state to yield. Sending deltas to a snapshot-shaped API is the
single most common integration bug.

## Tool UI (generative UI)

`makeAssistantToolUI` is **deprecated**. As of June 2026 the API is a toolkit:

```ts
const toolkit = defineToolkit({
  add_to_cart: { type: "backend", render: CartToolUI },
});
const aui = useAui({ tools: Tools({ toolkit }) });
```

The render component is `ToolCallMessagePartComponent<TArgs, TResult>` with props:
`{ args, result?, status, toolName, toolCallId, addResult, resume, interrupt? }`,
where `status.type ∈ "running" | "requires-action" | "incomplete" | "complete"`.
`type: "backend"` means **the SDK runs the tool; the component is UI-only** — a
direct map onto our `tool_start`/`tool_end` events (join by `toolCallId`).

**Treat these exact names as suspect** — verify against the Tool UI doc before
writing them.

## AgentEvent → assistant-ui

| `AgentEvent` | assistant-ui |
|---|---|
| `text_delta` | accumulate → a `{ type: "text" }` content part (yield accumulated) |
| `reasoning_delta` | accumulate → a reasoning content part |
| `tool_start` | a tool-call part in `running` status (`toolCallId`, `toolName`, `args`) |
| `tool_end` | resolve that part to `complete` (`result`, `isError`) — generative tool UI |
| `message` | a committed message (the runtime usually owns the thread) |
| `agent_start` / `turn_start` / `agent_end` | run/turn lifecycle → `isRunning`, step indicators |

## Styling

assistant-ui ships styles you must import (path varies by version — check the
styling page if `<Thread />` renders unstyled). The example imports
`@assistant-ui/react/styles/index.css`; confirm that path for your version.

## Version pin

The example pins `@assistant-ui/react@0.14.23` + React 18/19. Before relying on
it, run `npm view @assistant-ui/react version` and skim the changelog for runtime
or tool-UI breaking changes since 0.14.x.
