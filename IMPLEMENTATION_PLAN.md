# Plan: Port Tracer / observability onto the modern types

Bring `agent-core/observability` (Tracer, AsyncWriter) + its tests over from
`origin/claude/session-DemlF`. That branch predates the refactors, so it's a
**port**: string-literal roles/event-types → enums, wide `Message` → the
discriminated union, single `types.ts` → the `types/` barrel.

## Stage 1: Core seams the tracer taps
**Goal**: events + provider expose what the tracer reads, additively (no behavior change for existing callers).
- `types/events.ts`: `AgentStart` += `system?`, `tools?: ToolSpec[]` (type-only import)
- `primitives/loop.ts`: emit `AgentStart` with `{ system, tools: toolSpecs }`
- `providers/openai-compatible.ts`: add `onRequest` tap option + fire it in `run()`
**Success**: `bun run typecheck` clean; existing 225 tests still pass.
**Status**: Complete (typecheck shows errors ONLY in the un-ported tracer files)

## Stage 2: Port the observability module
**Goal**: `tracer.ts` / `tracer.types.ts` compile against modern types.
- `observability/async-writer.ts`: unchanged (pure strings, zero type deps)
- `observability/tracer.types.ts`: `TrajectoryStep.assistant` → `AssistantMessage`
- `observability/tracer.ts`: discriminants → `AgentEventType` / `StreamEventType` / `Role`; guard assistant-only fields (`tool_calls`, `reasoning`) via `isAssistantMessage`
- `index.ts`: export `Tracer` / `AsyncWriter` + their types
**Success**: `bun run typecheck` clean.
**Status**: Complete (module compiles; only the test remained)

## Stage 3: Port tests + docs
**Goal**: tracer/async-writer tests pass; provider `onRequest` test + README.
- `__tests__/tracer.test.ts`: `FakeModelClient`→`MockModelClient`; enum `type` + `timestamp` on manual `sink()` calls
- `__tests__/async-writer.test.ts`: unchanged
- `__tests__/openai-compatible.test.ts`: add `onRequest` test (modern message style)
- `agent-core/README.md`: add the tracing section
**Success**: `bun test agent-core` all green; typecheck clean.
**Status**: Complete (241 pass / 0 fail, typecheck clean; 15 tracer+writer tests)

---

# Plan: Message as a role-discriminated union

**Goal**: Replace the single wide `Message` interface (every role's fields
optional on one shape) with a discriminated union on `role` — `UserMessage`,
`SystemMessage`, `AssistantMessage`, `ToolMessage` — so illegal states are
unrepresentable: a tool message *must* carry `tool_call_id`, only assistant turns
carry `tool_calls`/`reasoning`, and `isError` lives only on the two roles that
can fail (assistant stream-error + tool). Construction tells you which fields
apply; reads narrow via `isAssistantMessage` / `isToolMessage`.

## Stage 1: the union + guards
**Files**: `agent-core/types/message.ts`
**Success**: `Message = UserMessage | SystemMessage | AssistantMessage |
ToolMessage`; `tool_call_id` required on `ToolMessage`; `isAssistantMessage` /
`isToolMessage` type guards exported. Reasoning resend docs preserved.
**Status**: Complete

## Stage 2: tighten the seams that are role-specific
**Files**: `model.types.ts` (StreamEvent Done/Error `message` → AssistantMessage),
`stop/conditions.types.ts` (`assistant` → AssistantMessage, `toolResults` →
ToolMessage[]), `primitives/loop.ts` (streamAssistant → AssistantMessage,
tool-result paths → ToolMessage, prepareRequestMessages narrows on role),
`providers/openai-compatible.ts` (assemble/emptyAssistant/isBlank →
AssistantMessage), `mocks/mock-model.ts`, `index.ts` exports.
**Success**: `bun run typecheck` clean; the loop.ts:448 error spread now legal
because AssistantMessage carries `isError`.
**Status**: Complete

## Stage 3: update call sites that read role fields off `Message[]`
**Files**: affected `__tests__/*` (filter/find via guards instead of `role ===`).
**Success**: `bun test agent-core` green (whole suite).
**Status**: Complete

---

# Plan: per-model reasoning kwargs (lookup table + proxy)

**Goal**: One lookup table maps a model id → the `chat_template_kwargs` that
enable/disable that model's thinking, handling each family's idiosyncrasies (GLM
`enable_thinking`+`clear_thinking`, Kimi `thinking`+`preserve_thinking`, DeepSeek
`thinking`, Qwen/Gemma `enable_thinking`; interleaved + non-reasoning families).
Consumed at the two places the model id is known: the `OpenAICompatibleModel`
provider (TS clients) and a thin standalone proxy (any OpenAI-compatible client).

Boring + explicit: first-match ordered rules on the lowercased id, default to
`undefined` (inject nothing) for unknown/non-reasoning models so it's always safe.

## Stage 1: the lookup table + resolver (pure)
**Goal**: `reasoning-kwargs.ts` exports `reasoningProfileFor(id)` (capabilities)
and `reasoningKwargsFor(id, mode)` → the kwargs object or `undefined`. `mode` is
`"on" | "off" | "auto"` ("auto" = the family's documented default).
**Files**: `agent-core/providers/reasoning-kwargs.ts`
**Success Criteria**: Every id in the catalog resolves to the right dialect;
unknown/non-reasoning → `undefined`; always-on/interleaved models (MiniMax-M2)
report `interleaved:true` and ignore "off".
**Tests** (`__tests__/reasoning-kwargs.test.ts`): one assertion per family +
the catalog ids; on/off/auto; unknown → undefined; Coder/Instruct exclusions.
**Status**: Complete (17 tests; full suite 160 green, typecheck clean)

## Stage 2: wire into OpenAICompatibleModel
**Goal**: Add `thinking?: "on" | "off" | "auto"` option. Explicit
`chatTemplateKwargs` still wins (escape hatch); otherwise derive from the model
id via the table. `thinking` unset → today's behavior (inject nothing).
**Files**: `agent-core/providers/openai-compatible.ts`, `agent-core/index.ts`,
`examples/running-product.ts` (drop the hardcoded GLM literal, use `thinking`).
**Success Criteria**: existing tests stay green; new tests assert per-model
derivation + escape hatch + opt-out.
**Status**: Complete (4 provider tests; example now uses `thinking: "on"`)

## Stage 3: the standalone proxy
**Goal**: A thin Bun reverse proxy in front of the endpoint. Pure
`injectReasoningKwargs(body, mode?)` (tested in agent-core) merges the kwargs by
`body.model`; the HTTP shell streams the response back. Per-request override via
`x-thinking` header.
**Files**: `agent-core/providers/reasoning-kwargs.ts` (the pure inject fn),
`proxy/thinking-proxy.ts` (Bun server, outside core like `bun-backends.ts`).
**Success Criteria**: `injectReasoningKwargs` unit-tested; proxy forwards +
streams against the real endpoint; explicit body kwargs pass through untouched.
**Status**: Complete (4 inject tests in core; proxy verified end-to-end against a
local echo upstream — per-model injection, `x-thinking` override, explicit-kwargs
passthrough, non-reasoning skip, server-key fallback all pass)

---

# Plan: credential substitution layer

**Problem**: When an agent has access to passwords/keys/tokens, the model and the
conversation transcript must never see the real secret. The model emits opaque
placeholders (`{{name}}`); at tool-execution time we look the name up in a
credential store and splice the real value in. On the way out we scrub any
resolved secret value back to its placeholder so an echoing command can't leak it.

**Design**: A sibling of `agent-core/permissions/` — a `CredentialStore` interface
+ `InMemoryCredentialStore` + a `withCredentials(tool, store)` decorator matching
the `with*` convention in `compose.ts`. Substitution happens at the generic tool
seam (`Tool.execute`), so it covers shell, search, and any future credentialed
tool. Placeholder syntax: `{{name}}` (no collision with shell `$VAR`). Output
scrubbing: on (scrub the values resolved during this call).

## Stage 1: CredentialStore seam + in-memory implementation
**Goal**: The lookup table behind an interface.
**Files**: `agent-core/credentials/credentials.types.ts`,
`agent-core/credentials/in-memory-credential-store.ts`
**Success Criteria**: `InMemoryCredentialStore` resolves known names, returns
undefined for unknown ones; seedable from a `Record` (env at startup).
**Tests** (`__tests__/credentials.test.ts`): resolve known → value; resolve
unknown → undefined; seeded from record.
**Status**: Complete

## Stage 2: substitution + scrub primitives (pure)
**Goal**: Pure functions: deep-walk args replacing `{{name}}`, and scrub a string
of resolved secret values. No tool/loop coupling — directly testable.
**Files**: `agent-core/credentials/substitute.ts`
**Success Criteria**: substitutes inside nested strings/objects/arrays; records
resolved (value→name) pairs; unknown placeholder throws a descriptive error;
scrub replaces every occurrence of each resolved value with its `{{name}}`;
non-string args untouched.
**Tests** (`__tests__/credentials.test.ts`): nested substitution; `Bearer {{t}}`
partial-string; unknown → throws; scrub round-trips value back to placeholder.
**Status**: Complete

## Stage 3: withCredentials decorator
**Goal**: Wrap a `Tool` so inbound args are substituted before `execute` and the
result content (and any thrown error) is scrubbed after.
**Files**: `agent-core/credentials/with-credentials.ts`
**Success Criteria**: decorated tool preserves name/description/schema; real value
reaches `execute`; `ToolResult.content` and thrown-error messages are scrubbed;
transparent when args carry no placeholders.
**Tests** (`__tests__/credentials.test.ts`): real value seen by execute; content
scrubbed; error message scrubbed; no-placeholder passthrough identical.
**Status**: Complete

## Stage 4: public surface + demo
**Goal**: Export from `agent-core/index.ts`; show a credentialed tool in `examples/running-product.ts`.
**Files**: `agent-core/index.ts`, `examples/running-product.ts`
**Success Criteria**: importable from the public surface; demo passes a `{{...}}`
placeholder that resolves at exec time; `bun test` + `bun run typecheck` green.
**Status**: Exports done (typecheck + 132 tests green). example demo deferred —
the war-and-peace counting task has no real secret to inject, so a demo there
would be contrived. Add a realistic example (e.g. an authenticated `curl`) on
request.
