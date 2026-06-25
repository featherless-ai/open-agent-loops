# Code execution (sandboxed)

The built-in `code_execution` tool over a **sandboxed Deno backend**. The model
writes a snippet, your machine runs it for real, and the captured output comes back
as the tool result — measured, never invented in the prompt.

## Run

```bash
cp .env.example .env   # at the repo root; fill in LLM_API_KEY and LLM_MODEL
bun run examples/code-execution/code-execution.ts
```

Needs the `deno` binary on PATH (https://deno.com) — the backend shells out to it.
`LLM_BASE_URL` defaults to `https://api.featherless.ai/v1`; point it at any
OpenAI-compatible endpoint. The default model is `deepseek-ai/DeepSeek-V4-Flash`
because it tool-calls cleanly (some models emit broken tool args, which mangles the
`code` string this tool depends on).

## What happens

```
┌─ your agent · one Bun process (trusted) ─────────────────────────────┐
│                                                                      │
│  model ─▶ code_execution({ language, code })   ← the model only ASKS │
│             │                                                        │
│             ▼   runAgent: validate args → backend.exec()             │
│             │   Bun.spawn(["deno","run", …])   ← launch a child      │
│             ▼                                                        │
│   ╔═ deno · child process — SANDBOXED, deny-by-default ═══╗          │
│   ║   runs the snippet for REAL → stdout / stderr / exit  ║          │
│   ╚════════════════════════╤═════════════════════════════╝          │
│             │  { stdout, stderr, exitCode }                          │
│             ▼   formatCodeExecutionResult() → "…\n[exit 0: ok]"      │
│   tool result ─▶ appended to history ─▶ next model turn reads it     │
└──────────────────────────────────────────────────────────────────────┘
```

1. The model emits a tool call — `code_execution({ language, code })`. That's all
   it produces; it runs nothing.
2. The loop validates the args and calls your backend.
3. `denoCodeExecutionBackend` launches `deno` as a child process, pipes the code in,
   and runs it inside Deno's **deny-by-default** sandbox — no file, network, or env
   access unless you granted it via `allow`.
4. The real `{ stdout, stderr, exitCode }` is captured and folded into one string,
   always ending in an exit verdict.
5. That string is appended to the conversation, so the *next* model turn reads the
   real result.

Two fields in (`language`, `code`), one string out:

| Code the model ran | What the model gets back |
|---|---|
| `console.log(6 * 7)` | `42`<br>`[exit 0: ok]` |
| `throw new Error('nope')` | `[stderr]`<br>`…nope…`<br>`[exit 1: error]` |
| `const x = 1 + 1` (never printed) | `[exit 0: ok]` |

The verdict is always present, so a run is **never** a contentless result —
"ran but printed nothing" reads as a clear success, not a blank.

## Don't like how it runs? Swap the backend.

`codeExecutionTool` is the stable, model-facing contract. The backend — *where* the
code actually runs — is yours to choose. Anything implementing `CodeExecutionBackend`
drops in:

```ts
interface CodeExecutionBackend {
  exec(
    request: { language: string; code: string },
    ctx: ToolContext,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}
```

Then it's a one-line swap in the example:

```ts
// shipped: sandboxed JS/TS, zero infra
const tool = codeExecutionTool(denoCodeExecutionBackend());

// your own: a container / microVM you control (multi-language, stronger isolation)
const tool = codeExecutionTool(myDockerBackend());

// a cloud variant: hand the code to a hosted execution service and await the result
const tool = codeExecutionTool(myHostedBackend());
```

The model, the loop, and the result format never change — only where the code runs.
That's the seam: the SDK owns the contract, you own the dangerous part.

## A note on safety

The Deno sandbox is *why* this example runs model-written code without a permission
gate: deny-by-default means the snippet can compute but can't touch your disk,
network, or environment. If you swap in an **unsandboxed** backend (or a powerful
cloud one), gate it — route `code_execution` through the permission gate in
`agent-loop-core/permissions` (see the Tools tutorial, Step 5) so a human signs off
before risky code runs.
