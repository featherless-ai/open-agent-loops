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
