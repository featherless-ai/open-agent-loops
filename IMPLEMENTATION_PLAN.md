# Plan: agent-built deterministic workflows (plan-as-code)

**Goal**: Let an agent *author* a workflow whose control flow is deterministic
TypeScript, while individual steps are non-deterministic LLM calls (`runAgent`).
Two halves, cleanly separated:

- **build-time (non-deterministic)** — an agent writes orchestration code.
- **run-time (deterministic)** — an executor runs that fixed code against a
  small runtime API whose primitives delegate to `runAgent`.

The skeleton (sequence/branch/parallel/loop) is frozen once authored; the only
non-determinism left is (a) the one-time build and (b) the LLM nodes inside.

Follows existing seams: no factories, plain interfaces + injected deps, Zod at
the tool boundary, verified against `FakeModelClient`.

## Stage 1: Workflow runtime + deterministic executor
**Goal**: `executeWorkflow({ code, model, memory, tools })` compiles a code
string into `async (wf, input) => result` and runs it; `wf.step()` delegates to
`runAgent`, `wf.parallel()` fans out, `wf.log()` observes.
**Files**: `agent-core/workflow/workflow.types.ts`, `agent-core/workflow/execute.ts`
**Success Criteria**: A hand-written code string drives a multi-step run; each
step is its own namespaced `runAgent`; the same code + same `FakeModelClient`
produces identical results every run.
**Tests** (`__tests__/workflow-execute.test.ts`):
- sequence: two steps run in order, second sees first's output threaded by code
- branch: a deterministic `if` on a step's output picks which step runs next
- parallel: `wf.parallel` runs steps concurrently, results in order
- tool resolution: a step names a tool; executor resolves it from the registry
- unknown tool name → descriptive throw
- determinism: running the same code twice yields identical output
- compile seam: a custom `compile` is used when provided
**Status**: Not Started

## Stage 2: The builder agent
**Goal**: `buildWorkflow({ model, memory, goal, availableTools })` runs an agent
with a single `emit_workflow` tool (Zod `{ code }`, `terminate: true`) that
captures the authored code.
**Files**: `agent-core/workflow/build.ts`
**Success Criteria**: Given a goal + tool catalog, the agent emits code; the
returned `code` round-trips straight into `executeWorkflow`.
**Tests** (`__tests__/workflow-build.test.ts`):
- agent emits code via the tool; `buildWorkflow` returns it
- build → execute round trip with `FakeModelClient` on both halves
- no emit (agent just talks) → empty/clear result, no crash
**Status**: Not Started

## Stage 3: Public surface + docs
**Goal**: Export from `index.ts`; document the build→execute loop and the
sandbox caveat (default `compile` is `AsyncFunction`, not a real sandbox).
**Files**: `agent-core/index.ts`, `agent-core/workflow/README.md`, README note
**Success Criteria**: `import { buildWorkflow, executeWorkflow } from "~/agent-core"`;
`bun test` + `bun run typecheck` green.
**Status**: Not Started

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
**Goal**: Export from `agent-core/index.ts`; show a credentialed tool in `main.ts`.
**Files**: `agent-core/index.ts`, `main.ts`
**Success Criteria**: importable from the public surface; demo passes a `{{...}}`
placeholder that resolves at exec time; `bun test` + `bun run typecheck` green.
**Status**: Exports done (typecheck + 132 tests green). main.ts demo deferred —
the war-and-peace counting task has no real secret to inject, so a demo there
would be contrived. Add a realistic example (e.g. an authenticated `curl`) on
request.
