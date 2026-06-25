# assistant-ui example (Layer C) — copy-paste starting point

A streaming chat UI for an agent-loop-core agent, with **no backend and no API
key**: the agent runs client-side on the `MockModelClient`, streamed through the
durable snapshot bridge. Get pixels first, wire a real model second.

> **Pinned & dated.** Built against `@assistant-ui/react@0.14.23` (June 2026).
> assistant-ui's runtime API churns — `makeAssistantToolUI` was already
> deprecated once. **Before relying on this, re-verify** the `useLocalRuntime` /
> `ChatModelAdapter` shape and the exports against the live docs:
> <https://www.assistant-ui.com/docs/runtimes/custom/local-runtime>. Only Layer C
> rots; the bridge under `assets/bridge/` does not.

## Run it (no backend)

```bash
# 1. Scaffold a React app (known-good boilerplate)
npm create vite@latest agent-chat -- --template react-ts
cd agent-chat

# 2. Add the pinned deps (see package.json in this folder)
npm install @assistant-ui/react@0.14.23 @open-agent-loops/core
#   (react / react-dom / vite / typescript come from the Vite template)

# 3. Copy these files into src/:
#      - assets/bridge/agent-snapshot.ts   → src/agent-snapshot.ts   (the bridge)
#      - assets/assistant-ui/src/agent-adapter.tsx → src/agent-adapter.tsx
#      - assets/assistant-ui/src/App.tsx           → src/App.tsx
#    (main.tsx + index.html come from the Vite template and already render <App/>)

# 4. Go
npm run dev
```

Type a message — the reply streams in. That stream is the agent loop's
`AgentEvent`s folded into snapshots by `agent-snapshot.ts` (Layer B) and yielded
as accumulated content to assistant-ui (Layer C).

## Go live (swap the mock for a real model)

Two changes, both isolated:

1. **Move `runAgent` to the server** behind the SSE transport so your API key
   never reaches the browser. Use `assets/bridge/sse-stream.ts`:
   ```ts
   // server.ts (Bun)
   import { runAgentSSE } from "./sse-stream";
   import { OpenAICompatibleModel } from "@open-agent-loops/core/providers/openai";
   import { SessionMemoryStore } from "@open-agent-loops/core";

   const model = new OpenAICompatibleModel({
     apiKey: process.env.LLM_API_KEY!,
     model: process.env.LLM_MODEL!,
     baseURL: "https://api.featherless.ai/v1",
     thinking: "on",
   });
   const memory = new SessionMemoryStore();

   Bun.serve({
     port: 8787,
     async fetch(req) {
       const { prompt } = await req.json();
       return runAgentSSE({ run: { model, memory, sessionId: "web", prompt } });
     },
   });
   ```
2. **Point the adapter at the stream** instead of running `runAgent` locally: in
   `agent-adapter.tsx`, replace the `MockModelClient` + local `runAgent` block
   with a `fetch("/api/chat", …)` that reads the SSE frames, `JSON.parse`s each
   `data:` line into an `AgentSnapshot`, and `yield { content: [{ type: "text",
   text: snap.current.text }] }`. The bridge and the rest of the adapter are
   unchanged — only the source of snapshots moves.

## Where to go next (all isolated to Layer C, all churny — verify first)

- **Reasoning panel** — map `snap.current.reasoning` to a reasoning content part.
- **Generative tool UI** — render `snap.current.toolCalls` with assistant-ui's
  current tool-UI API (the `defineToolkit` / `Tools` toolkit as of June 2026;
  `makeAssistantToolUI` is deprecated). Verify against
  <https://www.assistant-ui.com/docs/tools/tool-ui>.
- **Full agent state** — for tool cards + reasoning + app panels, graduate to the
  AssistantTransport runtime, which is built to stream whole-state snapshots —
  the exact shape `agent-snapshot.ts` already produces.
