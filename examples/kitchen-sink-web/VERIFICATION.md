# Kitchen-sink-web — verification checklist

Independent audit of the Deno + Next.js + assistant-ui capstone. Mark each item
**PASS / FAIL / UNCLEAR** with evidence (file:line or curl output). Audit only —
do not modify code.

## How to exercise it
- Dev server runs via `deno task dev` → http://localhost:3000 (real model via `.env.local`).
- Backend POST (assistant-transport protocol):
  ```
  curl -s -N -X POST http://localhost:3000/api/assistant -H 'content-type: application/json' \
    -d '{"commands":[{"type":"add-message","message":{"role":"user","parts":[{"type":"text","text":"PROMPT"}]}}],"state":{"messages":[]},"threadId":"ID"}'
  ```
  → streams `aui-state:[{"type":"set","path":[],"value":{"messages":[...]}}]` frames.

## A. Backend / transport
- [ ] A1. Route parses `add-message` → userText; reads prior `state.messages`. (`app/api/assistant/route.ts`)
- [ ] A2. Streams `aui-state:` frames via `createAssistantStreamResponse` + `update-state` set-ops. (`lib/bridge/assistant-transport.ts`)
- [ ] A3. State shape is `{ messages: ThreadMessageLike[] }`: user + one assistant msg with ordered reasoning/tool-call/text parts.
- [ ] A4. Tools actually execute (shell/search via `lib/node-backends.ts`); tool result lands in the tool-call part.

## B. UI rendering
- [ ] B1. Converter routes through `unstable_createMessageConverter().toThreadMessages()` (raw `ThreadMessageLike` get silently dropped). (`app/MyRuntimeProvider.tsx`)
- [ ] B2. Messages render end-to-end (user / reasoning / tool card / answer).
- [ ] B3. Composer stays docked after ≥2 messages (`min-h-0` chain in `app/page.tsx`).
- [ ] B4. Thread-list sidebar renders; new threads list (untitled "New Chat" is a known limitation, not a fail).

## C. Follow-ups (multi-turn)
- [ ] C1. Same thread, 2nd+ message: model receives prior turns (`SessionMemoryStore`, `sessionId = threadId`).
- [ ] C2. Different `threadId`s are context-isolated (no memory bleed).
- [ ] C3. UI history (`state.messages` round-tripped) vs server LLM memory don't desync or double-count.

## D. Cancellation  (suspected GAP)
- [ ] D1. Is `req.signal` forwarded route → transport → `runAgent({ signal })`?
- [ ] D2. On client cancel/disconnect, does the server abort the run AND kill tool subprocesses?
- [ ] D3. If not: confirm the run completes server-side after a cancel (wasted compute).

## E. Robustness / safety
- [ ] E1. Model error / tool error surfaces to the client (error frame), doesn't hang.
- [ ] E2. `LLM_API_KEY` never reaches the client; `withCredentials` scrubs secrets from tool output; `.env.local` gitignored.
- [ ] E3. Concurrency: singleton agent + per-session memory safe under simultaneous threads.
- [ ] E4. Perf: transport emits full-state JSON on every `AgentEvent` (per token) — acceptable or needs throttle/append-text?
- [ ] E5. `next build` (production) compiles — esp. the core's bare `import "openai"` in `dist/providers/openai.js`.

## F. Known limitations (confirm as documented, not regressions)
- [ ] F1. Threads untitled / not persisted (in-memory adapter hardcoded by `useAssistantTransportRuntime`).
- [ ] F2. Permissions auto-approve in v1 (no human-in-the-loop modal).
