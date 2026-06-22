# Plan: in-loop steering + follow-up (kernel pull-seams)

**Goal**: Let a caller inject messages into a *live* run — **steering** (redirect
mid-task, drained after a tool batch) and **follow-up** (extend a run past its
natural final answer) — as two optional pull-hooks the loop calls at its existing
boundaries.

**Why in-loop (not re-run/layer-above)**: the Tracer is built around a single
`agent_start → agent_end` with monotonic `step`s and one disclosure timeline
(`trajectory()` opens a step per `turn_start`; `disclosure()` diffs consecutive
requests; `startedAt`/`durationMs` assume one origin). Re-running to inject input
fragments one interaction into N runs with resetting step numbers — messy
telemetry. One continuous run = one clean trace. The hooks are the same shape as
the existing kernel hooks (`transformContext`/`gateToolCalls`/`afterToolCall`), so
they fit the kernel's seam pattern rather than violating "the kernel stays
untouched".

**Design**: the caller owns the queue (host-binding input feeds it → BYO); the
loop only *pulls*. Steering drains right after tool results are recorded (so
`tool_use`/`tool_result` pairing is intact), and **overrides** a tool `terminate`
and a `stopWhen`, but **never** the `maxSteps` safety cap (neither hook is even
drained once `steps >= maxSteps`). Follow-up drains at the natural stop. Injected
turns emit a labeled `message_injected` event so they're visible in telemetry and
distinguishable from a normal prompt.

## Stage 1: loop pull-seams + injection event
**Files**: `agent-core/types/events.ts` (`AgentEventType.MessageInjected` +
`InjectedMessageOrigin` + union arm), `agent-core/primitives/loop.ts`
(`Hooks.drainSteering`/`drainFollowUp`, an `injectMessages` helper, drain at the
two boundaries with the precedence above).
**Success**: hooks drain at the right boundaries; steering overrides
terminate/stopWhen but not maxSteps; injected msgs are pushed to
`messages`/`newMessages`, persisted via `memory.append`, and emitted as
`message_injected`; behavior byte-identical when both hooks are unset.
**Tests** (`__tests__/loop.test.ts`): steering injects after a batch and drives
another turn; follow-up continues past a natural stop; steering overrides a
terminating tool; maxSteps caps and the queue is *not* drained at the cap.
**Status**: Complete (4 tests; full suite green, typecheck clean)

## Stage 2: tracer folds `message_injected`
**Files**: `agent-core/observability/tracer.ts` (fold the event onto the current
`TrajectoryStep`, origin-labeled; render in `describe()`),
`agent-core/observability/tracer.types.ts` (`TrajectoryStep.injected?`).
**Success**: an injected turn shows in `trajectory()`/`formatTrajectory()` with
its origin, not just the raw `format()` timeline; steps stay monotonic.
**Tests** (`__tests__/tracer.test.ts`): a steering injection appears on the step.
**Status**: Complete (folds onto the step, origin-labeled; rendered as `↪`)

## Stage 3: MessageQueue battery (pure)
**Files**: `agent-core/primitives/message-queue.ts` (or `concurrency/`-style
sibling), `agent-core/index.ts` export.
**Success**: `push` / `drain` / `size` / `clear` with `mode: "one-at-a-time" |
"all"`; `drain` returns one or all queued messages per the mode; this is pi's
whole `steeringMode`/`followUpMode`/`clear*Queue` surface, caller-owned.
**Tests** (`__tests__/message-queue.test.ts`): mode drains; clear; FIFO order.
**Status**: Complete (6 tests incl. a runAgent integration drain)

## Stage 4: runnable example + docs note
**Files**: `examples/steering/` (non-blocking input — the readline loop is
blocking and *cannot* steer), docs note capturing "what we learned" (steering ≠
cancellation; it's additive injection at a boundary; follow-up vs steering vs
abort).
**Success**: demo steers a live run and follows up, with a tracer showing both
injections inline; `bun test` + `bun run typecheck` green.
**Status**: Complete (`examples/steering/` + README; example typechecks under
project settings)

---

# Plan: Multimodal user content (OpenAI-compatible parts)

**Goal**: A user turn can carry images, audio, and files — not just text —
mirroring OpenAI chat-completions content parts exactly, so the existing egress
passes them straight to the wire. Multimodal is INPUT-only and `user`-only in the
chat-completions spec (assistant turns stream string content + tool calls), so
only `UserMessage.content` widens; system/assistant/tool stay `string`, keeping
"an assistant can't carry an image" a compile error.

## Stage 1: the ContentPart union + factories (pure)
**Files**: `agent-core/types/content-part.ts`, `agent-core/types/index.ts`.
**Success**: `ContentPart = TextPart | ImagePart | AudioPart | FilePart`, each
shape identical to OpenAI's `ChatCompletionContentPart` member; `textPart` /
`imagePart` / `audioPart` / `filePart` factories; `contentToText` flattens a
`string | ContentPart[]` to a display string (text verbatim, non-text →
`[image]`/`[audio]`/`[file: name]`).
**Tests** (`__tests__/content-part.test.ts`): each factory's shape; contentToText
string passthrough + mixed-parts flatten.
**Status**: Complete

## Stage 2: widen UserMessage.content + wire egress/tracer
**Files**: `agent-core/types/message-base.ts` (base `content: string |
ContentPart[]`), `system-message.ts` / `assistant-message.ts` / `tool-message.ts`
(pin `content: string`), `user-message.ts` (explicit wide override + doc),
`providers/openai-compatible.ts` (user egress passes parts through),
`observability/tracer.ts` (flatten via contentToText), `agent-core/index.ts`
(export the parts + factories).
**Success**: `tsc --noEmit` clean; egress emits `content: ContentPart[]` for a
multimodal user turn; string turns unchanged; assistant/system/tool still
compile against `string`.
**Tests** (`__tests__/openai-compatible.test.ts`): a user turn with image+file
parts round-trips through `toChatMessages` verbatim.
**Status**: Complete

---

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

# Plan: per-model reasoning kwargs (lookup table)

**Goal**: One lookup table maps a model id → the `chat_template_kwargs` that
enable/disable that model's thinking, handling each family's idiosyncrasies (GLM
`enable_thinking`+`clear_thinking`, Kimi `thinking`+`preserve_thinking`, DeepSeek
`thinking`, Qwen/Gemma `enable_thinking`; interleaved + non-reasoning families).
Consumed where the model id is known: the `OpenAICompatibleModel` provider.

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

---

# Plan: background agents (Supervisor + ParentAgent)

**Goal**: A detached, observable, cancellable agent run — a *background agent* —
plus the layer that owns many of them. Today's `runAgent` is the *special case*:
one consumer that also `await`s the result and holds the control flow. The
background case relaxes all three (zero-or-many late-joining consumers, result as
a `Promise` on a handle, a supervisor holding the run), and that is where the
machinery lives. The loop (`primitives/loop.ts`) is the kernel and stays untouched.

**Design**: Two layers, kept distinct.
- **`Supervisor`** — the mechanism. A registry of live runs, the
  `BackgroundAgent` handles, and a multicast event broker. It does not reason; it
  tracks lifecycles. `Supervisor.spawn(spec)` runs a detached `runAgent` and
  catches failure into handle status rather than letting it escape. Concurrency is
  *not* capped here — it's enforced upstream by the shared Featherless gate (own
  plan) wrapping the model client every agent uses.
- **`ParentAgent`** — a *role*, not a new class: any `runAgent` wired with the
  supervisor's bridge tools (`poolTools`) and a profile. It reasons, calls
  `spawn_agent` / `list_agents` / `follow_up`, and decides follow-ups by judgment.
  "Parent" is relational and recursive — a child holding `poolTools` is itself a
  parent to *its* spawns (turtles all the way down). Every agent shares **one**
  Featherless concurrency gate at the model client, so model requests across the
  whole tree contend for a single budget — a recursive spawn-storm throttles
  itself.

Two lines held deliberately:
- **Follow-ups are reactive, never a pre-authored DAG.** A follow-up is decided at
  settle time from the actual result and enqueued as a plain `spawn`/`continue` —
  not a static dependency graph declared up front. That graph was the
  `workflow.types.ts` seam removed in e0f7fa3; we are not resurrecting it.
- **Profile is not the transcript.** "What is durably true about the user" is a
  second serializable seam (`ProfileStore`, JSON) beside conversation `Memory`
  (`Message[]`), delivered ambiently via the system prompt and snapshotted into a
  context pack at spawn (detachment forces serialization).

The one genuinely new primitive is **multicast events**: foreground has a single
synchronous `onEvent`; a background run may have zero or many late-joining
subscribers and must never block on a consumer. Hence an event broker that fans
each `AgentEvent` to N subscribers and keeps a ring buffer for late joiners.

## Stage 1: multicast event broker (pure)
**Goal**: The pure primitive the supervisor needs for late-joining observers — no
model, no time. (Concurrency is its own plan — the Featherless gate.)
**Files**: `agent-core/supervisor/event-broker.ts` (`EventBroker`: `publish`,
`subscribe → unsubscribe`, `recent()`).
**Success Criteria**: `EventBroker` fans one event to every live subscriber, drops
one on unsubscribe, keeps the last K events for a late joiner, and never awaits a
slow sink (publish is non-blocking).
**Tests** (`__tests__/event-broker.test.ts`): broker delivers to two subscribers;
late subscriber replays last K; unsubscribe stops delivery; a slow sink doesn't
block publish.
**Status**: Not Started

## Stage 2: BackgroundAgent handle + Supervisor
**Goal**: A detached `runAgent` behind a handle, owned by a registry that caps
concurrency and survives child failure.
**Files**: `agent-core/supervisor/supervisor.types.ts` (`BackgroundAgent`,
`AgentTaskSpec`, `TaskStatus`, `SupervisorEvent`),
`agent-core/supervisor/background-agent.ts` (handle: tees the run's `onEvent` into
an `EventBroker`, owns an `AbortController`),
`agent-core/supervisor/supervisor.ts` (`Supervisor`:
`spawn`/`get`/`list`/`running`/`cancel`), `agent-core/index.ts` (exports).
**Success Criteria**: `spawn(spec)` returns immediately with a `BackgroundAgent`
(`status` `pending`→`running`); `result` resolves to the run's `RunResult`;
`subscribe` streams live `AgentEvent`s and `recentEvents()` replays; `cancel()`
aborts the run (`status: cancelled`); a thrown run becomes `status: failed` with
the error on the handle, not an unhandled rejection; with the limiter full an
extra `spawn` is `queued` and starts when a slot frees; `running().length` equals
`limiter.active`.
**Tests** (`__tests__/supervisor.test.ts`, `MockModelClient`): spawn → result;
late subscriber replay; cancel mid-run; failing run → failed status with no
escape; queueing past the limit; `running()` ↔ `active` invariant.
**Status**: Not Started

## Stage 3: Follow-ups (reactive)
**Goal**: A settled (or running) agent can enqueue more work — same-session
`continue` or dependent `spawn` — decided at settle time, no DAG.
**Files**: `agent-core/supervisor/supervisor.ts` (`followUp(id, FollowUp)`,
settle-time enqueue), `agent-core/supervisor/supervisor.types.ts` (`FollowUp`
union), `agent-core/tools/builtin/follow-up.ts` (`request_follow_up` tool:
`terminate: true` + records a spec the supervisor reads on settle).
**Success Criteria**: `{ kind: "continue", message }` appends a `UserMessage` to
the child's session (`Memory`) and re-runs it, preserving context;
`{ kind: "spawn", task }` starts a new background agent seeded with the
predecessor's result; an optional `onSettle(result, handle) → FollowUp[]` policy
is honored; a child calling `request_follow_up` terminates and the supervisor
enqueues its spec; follow-ups ride the same shared limiter.
**Tests** (`__tests__/supervisor-followups.test.ts`): continue threads prior
context; spawn seeds predecessor result; `request_follow_up` round-trips through
settle; `onSettle` enqueue; a follow-up that spawns a follow-up still respects N.
**Status**: Not Started

## Stage 4: schedule() trigger (Clock + Schedule)
**Goal**: Time-triggered spawns — the *scheduled task* special case — as a thin
trigger over the supervisor, with time injected for testability.
**Files**: `agent-core/supervisor/clock.ts` (`Clock` interface; `SystemClock`
default over `setTimeout`), `agent-core/supervisor/schedule.ts` (`Schedule`
interface `nextFireAt(after) → number | null`; `at`/`after`/`every`),
`agent-core/supervisor/scheduler.ts` (`schedule(spec, Schedule)` arms a `Clock`
timer that calls `Supervisor.spawn` when due; recurring re-arms),
`agent-core/mocks/manual-clock.ts` (`ManualClock` test double).
**Success Criteria**: `every(ms)` fires repeatedly; `at`/`after` fire once; a due
firing with no free slot defers per policy (skip vs queue), never silently
dropped; `stop()` cancels pending timers; all driven by `ManualClock` with zero
real waiting.
**Tests** (`__tests__/scheduler.test.ts`, `ManualClock`): `after` fires once at T;
`every` fires N times across advances; due-while-full defers; cancel stops future
firings; pure `Schedule.nextFireAt` table per constructor.
**Status**: Not Started

## Stage 5: ProfileStore + poolTools → a working ParentAgent
**Goal**: The "learn about you" seam and the bridge tools that turn a `runAgent`
into a `ParentAgent`, assembled into one runnable demo.
**Files**: `agent-core/profile/profile.types.ts` (`ProfileStore`
`load(scope)`/`save(scope)`; `Profile = Record<string, unknown>`),
`agent-core/profile/in-memory-profile-store.ts` (`InMemoryProfileStore` default),
`agent-core/tools/builtin/pool-tools.ts` (`poolTools(supervisor)` → `spawn_agent`
/ `list_agents` / `follow_up` / `cancel_agent`), `agent-core/index.ts`,
`examples/parent-agent.ts`.
**Success Criteria**: a profile loads by `scope`, renders into the parent's system
prompt (ambient, not a tool), and is snapshotted into each child's context pack at
spawn; `poolTools` lets a model spawn/list/follow-up/cancel children; an explicit
`remember`-style write persists a fact (distillation deferred); the example wires
`runAgent({ system: profilePrompt, tools: [...poolTools(sup)] })` and a child run
streams back through the parent. `bun test` + `bun run typecheck` green.
**Tests** (`__tests__/profile.test.ts`, `__tests__/pool-tools.test.ts`): profile
load/save by scope; the context-pack snapshot is frozen (a post-spawn profile edit
doesn't change the in-flight child); `spawn_agent` creates a handle the supervisor
lists; `follow_up` tool enqueues; `cancel_agent` cancels.
**Status**: Not Started

---

# Plan: Featherless concurrency gate (live, model-request backpressure)

**Goal**: Admission control on outgoing **model requests**, paced to the *live*
Featherless concurrency budget. Concurrency on Featherless is a weighted,
account-wide budget (cost by model size: 7–15B → 1, 24–34B → 2, 70B+ → 4; plan
allotments Basic 2 / Premium 4 / Scale 8/unit; over-budget requests are **429**'d).
We don't replicate that accounting — the server owns it. The gate just asks "is
there room right now?" before each call and **waits** if not.

**Design**: a pre-call gate, *not* a semaphore (the weighted-semaphore primitive was
tried and dropped — leases/FIFO/cost-weighting solved a problem we don't have).
`withModelGate(model, gate)` (a `compose.ts` decorator) awaits a BYO `ModelGate`
*before* `model.stream()` is even invoked, so a full budget holds the turn at the
model boundary without converting messages or touching the wire. The gate is
**abort-aware**: it honors `request.signal`, so a run cancelled while parked unwinds
instead of hanging. Behavior with no room: **wait, then take the turn once a slot
frees** (`used < limit` again); the only other exit is cancel. (No timeout / retry
cap — an impossible-fit request, e.g. a 70B on a Basic plan, waits until cancelled,
by design.)

The Featherless **battery** behind the gate is a live meter: subscribe to
`GET /account/concurrency/stream` (SSE — one frame on connect, then every 2s), hold
`{ limit, used }`, and resolve the gate when `limit === null || used < limit`,
re-checked on each frame. Because the stream is account-wide, the gate also respects
budget consumed by *other* clients/keys — the whole point of "live". A server 429
(someone grabbed the freed slot in the 2s gap) is folded back into the wait —
"still full" — not surfaced as an error, keeping the two exits intact.

## Stage 1: withModelGate decorator (abort-aware)
**Goal**: The pre-call seam — await admission before each stream, cancel-aware.
**Files**: `agent-core/compose.ts` (`ModelGate` type + `withModelGate`),
`agent-core/index.ts` (exports).
**Success Criteria**: `withModelGate(model, gate)` awaits `gate(request)` before
`model.stream` is called; on resolve the call proceeds and every `StreamEvent` is
forwarded unchanged; on reject (e.g. the gate honoring `request.signal` on abort)
the stream rejects and the inner model is never invoked; transparent for a no-op
gate; stacks with `withModelObserver`.
**Tests** (`agent-core/__tests__/compose.test.ts`): the model isn't called until the
gate resolves; an abort while parked rejects and never calls the model; a no-op gate
is transparent.
**Status**: Complete (3 tests; compose suite 16 green, typecheck clean)

## Stage 2: Featherless concurrency meter (live battery)
**Goal**: A live `{ limit, used }` view of the account budget the gate waits on,
plus the gate function itself.
**Files**: `agent-core/concurrency/parse-frame.ts` (pure `data: {…}` SSE frame →
`{ limit, used_cost, request_count }` snapshot), `agent-core/concurrency/featherless-meter.ts`
(subscribe to `/account/concurrency/stream`; expose `limit` / `used` / `nextFrame()`;
a `gate` that waits until `used < limit`, abort-aware; `/account/concurrency` one-shot
fallback; reconnect on drop; a 429 from the call re-enters the wait).
**Success Criteria**: parses the documented payload (incl. `limit: null` → unbounded
→ gate never waits); the gate resolves immediately when there's room and parks until
the next frame shows room when full; honors `request.signal`; survives a dropped
stream by reconnecting.
**Tests** (`agent-core/__tests__/featherless-meter.test.ts`, fake event source):
parse the sample frame; gate passes when `used < limit`; gate parks then resolves
when a frame frees room; abort while parked rejects; `null` limit never parks.
**Status**: Not Started

## Stage 3: wiring + example
**Goal**: Compose the gate onto a real model client and show backpressure + cancel.
**Files**: `examples/concurrency-gate/` (wire `withModelGate(model, meter.gate)`
around an `OpenAICompatibleModel`, reading `FEATHERLESS_API_KEY` from `.env`), docs note.
**Success Criteria**: a run paces itself against the live budget; a parked run cancels
cleanly via an `AbortController`; `bun test` + `bun run typecheck` green.
**Status**: Not Started

---

# Plan: live-ingress channels with backpressure

**Goal**: Let a long-lived, bursty transport (Slack/Discord websocket) feed
`runAgent` without coupling the two rate domains — the socket must drain
continuously (stall it and you get disconnected) while the model is slow and
rate-limited. The fix is a bounded queue between them as an impedance matcher,
plus a session-keyed dispatcher that owns throttling. See
[`agent-core/docs/channels.md`](agent-core/docs/channels.md) for the design.

**Load-bearing constraint**: `runAgent` does not change. Everything new is a seam
(`ChannelSource`, multiple impls) plus caller-owned policy (the buffer + the
dispatcher). `Memory`, `signal`, and the `EventSink` are reused as-is.

**Backpressure model**: one primitive, both directions. A `BoundedBuffer<T>` sits
between a fast and a slow side; the only variable is the overflow policy. Inbound
(unblockable socket) sheds — `drop-oldest`/`coalesce`. Outbound (blockable loop)
can `block` to propagate real backpressure upstream, or `coalesce` reply deltas
before a rate-limited `send`. "Bounded" keeps the system from breaking; the
buffer's `dropped`/`highWater` readings are what a later adaptive controller acts
on. Bounded ≠ adaptive.

**Relation to the Featherless gate plan (above)**: that plan throttles *egress*
(model requests, paced to the live provider budget) at the model boundary. This
plan throttles *ingress* (inbound channel traffic) at the dispatcher. The
dispatcher's global concurrency cap (Stage 2) and the Featherless gate are
complementary and compose — the gate is the deeper, account-wide protection the
dispatcher's coarse semaphore can defer to.

## Stage 1: `BoundedBuffer<T>` primitive
**Goal**: A pure, host-agnostic bounded FIFO with a pluggable overflow policy —
the impedance matcher, usable inbound and outbound. `MessageQueue` becomes its
`capacity: Infinity` specialization so steering/follow-up are unaffected.
**Files**: `agent-core/primitives/bounded-buffer.ts`,
`agent-core/primitives/message-queue.ts` (re-based on it), `agent-core/index.ts`.
**Success Criteria**: `drop-oldest`/`drop-newest`/`block`/`coalesce` each behave
per spec; `block` reports blocked items without dropping them (caller owns
upstream backpressure); `size`/`dropped`/`highWater` expose the load readings;
`capacity >= 1` enforced; `MessageQueue` API byte-identical; suite + typecheck
green.
**Tests** (`__tests__/bounded-buffer.test.ts`): one per policy, `highWater` across
drains, `capacity < 1` throws, `Infinity` never overflows; existing
`message-queue.test.ts` still passes.
**Status**: Complete (9 tests; full suite 324 green, typecheck clean)

## Stage 2: session-keyed dispatcher
**Goal**: The throttling layer between the source and `runAgent`. Owns: at most
one in-flight run per `sessionId` (concurrent runs would corrupt `memory.append`
ordering); a per-session `BoundedBuffer` that debounces/coalesces a burst into a
single `Message[]` prompt; a global concurrency semaphore across all sessions
(protects the provider rate limit); and supersede-via-`AbortSignal` so a newer
message can cancel a stale in-flight run instead of queueing behind it.
**Files**: `agent-core/channels/dispatcher.ts`,
`agent-core/channels/dispatcher.types.ts`, `agent-core/index.ts`.
**Success Criteria**: N messages to one session in a burst → one `runAgent` call
with the coalesced prompt; two sessions never interleave a session's runs; no more
than `maxConcurrency` runs in flight at once (excess waits); supersede cancels the
prior run's `signal`; per-session overflow follows the buffer policy.
**Tests** (`__tests__/dispatcher.test.ts`, `MockModelClient` + a fake clock):
burst coalesces to one run; per-session serialization holds under interleaved
pushes; semaphore caps global in-flight; supersede aborts the stale run; overflow
drops/coalesces per policy.
**Status**: Not Started

## Stage 3: `ChannelSource` seam + in-memory fake
**Goal**: The transport seam (analogous to `ModelClient`) that owns liveness only
— connect/disconnect, heartbeat, reconnect with backoff, resume cursors —
normalizes provider events into one `InboundMessage { channelId, threadId,
userId, text }`, maps `thread → sessionId`, and sends replies out by consuming the
`EventSink` (`TextDelta`). Ship an `InMemoryChannelSource` fake so the whole path
is unit-testable without a real socket; coalesce outbound deltas through a
`BoundedBuffer` before `send`.
**Files**: `agent-core/channels/channel-source.types.ts`,
`agent-core/channels/in-memory-channel-source.ts`, `agent-core/index.ts`.
**Success Criteria**: `InMemoryChannelSource` drives the dispatcher end-to-end;
inbound events become runs keyed by the mapped `sessionId`; `TextDelta`s stream
back coalesced; liveness concerns never touch the model path.
**Tests** (`__tests__/channel-source.test.ts`): fake source → dispatcher →
`runAgent` (mock) → reply deltas captured; thread→session mapping reuses `Memory`
across messages on the same thread.
**Status**: Not Started

## Stage 4: runnable example + adaptive note
**Goal**: An `examples/channels/` end-to-end using `InMemoryChannelSource`
(scripted bursty traffic) so the backpressure story is observable — print
`dropped`/`highWater` as load rises. Document the seam boundary (connect =
`ChannelSource`, throttle = dispatcher, adapt = a controller reading the buffer
metrics) and what a v1 adaptive controller (AIMD on concurrency, coalesce-window
on `highWater`) would add, without building it yet.
**Files**: `examples/channels/`, docs note.
**Success Criteria**: example runs against `MockModelClient`, shows coalescing and
shedding under a burst; docs note captures the layering and the open questions
from `channels.md`.
**Status**: Not Started

**Open questions** (from `channels.md`): coalescing window (fixed vs quiet-period
vs adaptive); overflow policy per channel; supersede vs finish on a mid-run
message; session granularity (thread/channel/user); whether the global semaphore
needs per-tenant quotas for v1, or defers entirely to the Featherless gate.
