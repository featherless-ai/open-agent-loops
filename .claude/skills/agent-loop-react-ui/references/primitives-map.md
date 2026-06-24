# Primitives map — Layer A (agent + orchestrator)

Everything here is a published export of `@open-agent-loops/core`. **Confirm against the installed package before importing** — grep `node_modules/@open-agent-loops/core/dist/index.d.ts` or the source `agent-loop-core/index.ts`. The package has been refactored (the source dir was renamed `agent-core` → `agent-loop-core`); treat any path from memory as suspect.

## Import surface (three entry points)

```ts
// core — runs everywhere (Node, Bun, Deno, browser). No `openai` pulled in.
import { runAgent, SessionMemoryStore, defineTool, ToolRegistry /* … */ } from "@open-agent-loops/core";

// model client — server-side opt-in (pulls the `openai` peer dep).
import { OpenAICompatibleModel } from "@open-agent-loops/core/providers/openai";

// streaming test double — handy for building the UI with NO backend / no key.
import { MockModelClient } from "@open-agent-loops/core/mocks/mock-model";
```

## Agent — the inner loop

| Concern | Symbol | Notes |
|---|---|---|
| The loop | `runAgent(opts): Promise<RunResult>` | `opts: { model, memory, sessionId, prompt, system?, tools?, maxSteps?, stopWhen?, hooks?, toolExecution?, onEvent?, signal? }` |
| Model boundary | `ModelClient` (interface) | implement `{ stream }`; or use a battery below |
| Model battery | `OpenAICompatibleModel({ apiKey, model, baseURL?, thinking?, chatTemplateKwargs? })` | Featherless/vLLM/DeepSeek/etc. `baseURL` defaults are provider-specific; Featherless is `https://api.featherless.ai/v1` |
| Model (no backend) | `MockModelClient` | scripted streaming — render the whole UI client-side with no API key |
| Memory | `SessionMemoryStore` / `Memory` | one store + one `sessionId` per conversation = multi-turn |
| Tools | `defineTool({ name, description, parameters /* zod */, execute, executionMode? })` | arg types inferred from the Zod schema |
| Tool catalog | `ToolRegistry([...tools])` | `.list()`, resolve subsets by name |
| Built-in tools | `shellTool`, `codeExecutionTool`, `searchTool`, `readTool`/`globTool`, `writeTool`/`editTool`, `webFetchTool`/`webSearchTool`, `browserTools` | SDK ships the contract; **you supply the backend** (host-binding) |
| Planning tools | `scratchpadTools(InMemoryScratchpad)`, `todoListTools(InMemoryTodoStore)` | fully shipped (pure in-memory) |
| Stop conditions | `maxSteps`, `whenToolCalled`, `any`, `all`, `not` | compose; `runAgent` also has its own `maxSteps` cap (default 10) |
| Skills | `SkillRegistry`, `skillTool`, `skillResourceTool` | model pulls instruction+tool bundles on demand |
| Permissions | `permissionGate(store, prompter)`, `InMemoryPermissionStore`, `PermissionPolicy`, `ApprovalChoice` | wire via `hooks.gateToolCalls` |
| Credentials | `withCredentials`, `InMemoryCredentialStore` | inject secrets without leaking to the model |
| Reasoning kwargs | `injectReasoningKwargs`, `reasoningProfileFor`, `reasoningKwargsFor` | per-family thinking toggles |
| Decorators | `withModelGate`, `withModelObserver`, `withMemoryListeners`, `withMemoryNamespace` | compose around the seams |

### Hooks (on `RunAgentOptions.hooks`)

| Hook | Fires | Use for |
|---|---|---|
| `transformContext(messages)` | before each model send | compaction / context engineering |
| `gateToolCalls(batch)` | once per turn, before tools run | allow/deny/ask (permissions) |
| `afterToolCall(info)` | after each tool | inspect/override a result |
| `drainSteering()` | after a tool batch | inject mid-run redirects |
| `drainFollowUp()` | at a natural stop | extend past the final answer |

`drainSteering` / `drainFollowUp` are pull-seams — pair them with `MessageQueue` or `BoundedBuffer` (the caller owns the queue; the loop only pulls).

## Orchestrator — compositions over `runAgent`

All three share the same convention: an `Omit<RunAgentOptions, …>` "RunBase" of the shared per-run config, with the orchestrator supplying the parts it controls. None modify the loop.

### `runGoal` — outer loop until a goal is graded done
```ts
import { runGoal, modelGrader } from "@open-agent-loops/core";
const result = await runGoal({
  goal: "…natural-language objective…",
  grader: modelGrader({ model: fastModel }),     // or BYO (ctx) => { done, feedback?, score? }
  base: { model, memory, sessionId, tools, system },   // RunBase: no prompt/signal
  maxRounds: 5,
  onRound: ({ round, grade }) => {/* telemetry */},
});
// → { done, rounds, grade, result }
```

### `agentAsTool` — a sub-agent as a tool a parent routes to
```ts
import { agentAsTool, runAgent } from "@open-agent-loops/core";
const researcher = agentAsTool({
  name: "researcher",                    // snake_case, model-facing
  description: "Researches a question and reports findings.",
  model, system: "…", tools: [webSearchTool(backend)],
  // context-isolated by default: fresh session per call; pass memory+sessionId for continuity
});
await runAgent({ model, memory, sessionId, tools: [researcher], prompt: "Compare X and Y." });
```

### `Dispatcher` / `ChannelBridge` — many sessions, backpressure, live transports
```ts
import { ChannelBridge, InMemoryChannelSource } from "@open-agent-loops/core";
const bridge = new ChannelBridge({
  source,                                          // a ChannelSource (Slack/Discord/fake)
  base: { model, memory, tools, system, onEvent }, // RunBase: no sessionId/prompt/signal
  capacity: 64, overflow: "drop-oldest", maxConcurrency: 4, supersede: false,
});
await bridge.start();
```
`ChannelBridge` already coalesces outbound `text_delta`s through a per-session `BoundedBuffer` and flushes one reply per assistant turn — study it as the canonical coalescing example before writing Layer B.

## Backpressure / steering primitives (used by Layer B)

| Symbol | Shape |
|---|---|
| `BoundedBuffer<T>({ capacity, overflow, mode? })` | `push(...items)`, `drain()`, `size`, `dropped`, `highWater`. `overflow: "drop-oldest" | "drop-newest" | "block" | { coalesce }` |
| `MessageQueue` | `BoundedBuffer` with `capacity: Infinity` — plain FIFO for steering/follow-up |

The capacity-1 + coalesce pattern is the token folder:
```ts
new BoundedBuffer<string>({
  capacity: 1,
  overflow: { coalesce: (buffered, incoming) => [(buffered[0] ?? "") + incoming] },
});
```

## Observability (optional, useful in a UI)

| Symbol | Use |
|---|---|
| `Tracer` | records a run's trajectory off the event/model/SSE seams |
| `toCurl` | reconstruct a runnable curl from a captured request (great "copy as curl" UI button) |
