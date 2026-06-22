# Credential flow: skill + `withCredentials`

How a secret reaches the shell without the model ever seeing its value, using the
`secret-hello-skill` example. There are two phases: loading the skill
instructions (no secret involved), then the credential-bearing shell tool call
(where the real secret is briefly live).

## Sequence diagram

```mermaid
sequenceDiagram
    autonumber
    participant M as Model (LLM)
    participant L as Loop (runAgent)
    participant SK as skillTool
    participant W as shell (withCredentials wrapper)
    participant S as CredentialStore
    participant I as inner shellTool → ./secret-hello

    Note over M,SK: Phase 1 — load skill instructions (no secret involved)
    M->>L: tool call · skill("secret-hello")
    L->>SK: execute({ name: "secret-hello" })
    SK-->>L: ToolResult · instructions (contain "{{secret_hello_token}}" verbatim)
    L-->>M: tool message · placeholder intact (just a label)

    Note over M,W: Phase 2 — model drives the wrapped shell tool
    M->>L: tool call · shell({ command: "...{{secret_hello_token}}... \"Ada\"" })
    L->>W: execute(args, ctx)   %% loop.ts:673

    rect rgb(255, 235, 235)
        Note over W,I: real secret is LIVE only inside this block
        W->>S: substituteCredentials → resolve("secret_hello_token")
        S-->>W: "s3cr3t-hello-key"
        Note over W: value = command with real key spliced in
        W->>I: execute(value, ctx)
        I->>I: child process runs ./secret-hello with real key
        I-->>W: ToolResult · content (may echo the key)
        Note over W: scrubSecrets(content, resolved) → key replaced by "{{secret_hello_token}}"
    end

    W-->>L: scrubbed ToolResult
    L-->>M: tool message · scrubbed (placeholder again)
```

## What the diagram shows

- **`skillTool` (steps 2–4)** only ever moves the placeholder *name* around — it
  touches the conversation, never the value. The skill is pure instructions; it
  is not wrapped with `withCredentials`.
- **The red block (steps 7–11)** is the *only* place the real secret exists,
  bounded by `substituteCredentials` on the way in and `scrubSecrets` on the way
  out, both inside the `withCredentials` wrapper.
- **Everything crossing the Model lifeline** — steps 1, 4, 5, 12 — carries
  placeholders only.

## The mental separation that matters

| Component | Role | Sees the real value? |
| --- | --- | --- |
| **Skill** (instructions) | Carries the placeholder *name* into the conversation | No |
| **`withCredentials`** (on the shell tool) | Materializes the real value for exactly one `execute` call | Yes — briefly |
| **Inner shell tool / binary** | Runs the command with the real value spliced in | Yes — at exec time |
| **Model** | Reads/writes placeholders on both ends | No |

The skill could be anything — it just has to tell the model which placeholder
name to use. The credential machinery lives entirely on the tool, not the skill.
That's why the same `shell` tool, wrapped once, works for any skill that
references `{{secret_hello_token}}`.
