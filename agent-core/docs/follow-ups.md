# Follow-ups

There are two nested kinds of "follow-up" in the agent, and both run on the same
move: **append to `messages`, then call the model again.** The loop itself holds
no state — continuity lives entirely in the `Memory` store, keyed by `sessionId`.

## 1. Conversational follow-up (across `runAgent` calls)

A follow-up is just another `runAgent` call with the **same `sessionId`**. The
load-bearing step is `Memory.load(sessionId)` at the start of the second run — it
returns the first run's turns, so the model is handed the whole thread.

```mermaid
sequenceDiagram
    actor Caller
    participant Loop as runAgent
    participant Memory
    participant Model as ModelClient

    Note over Caller,Model: Run 1 - first message (session s)
    Caller->>Loop: runAgent(session s, prompt 'Weather in Paris?')
    Loop->>Memory: load(s)
    Memory-->>Loop: empty - nothing yet
    Loop->>Memory: append(s, user msg)
    Loop->>Model: stream(user)
    Model-->>Loop: assistant 'Sunny in Paris' - no tool calls, done
    Loop->>Memory: append(s, assistant msg)
    Loop-->>Caller: RunResult

    Note over Caller,Model: Run 2 - follow-up on the SAME session
    Caller->>Loop: runAgent(session s, prompt 'And tomorrow?')
    Loop->>Memory: load(s)
    Memory-->>Loop: user + assistant (run 1 turns)
    Loop->>Memory: append(s, user msg)
    Loop->>Model: stream(user, assistant, user) - full history
    Model-->>Loop: assistant 'Rainy tomorrow'
    Loop->>Memory: append(s, assistant msg)
    Loop-->>Caller: RunResult
```

## 2. Within-run follow-up (tool-use continuation)

Inside a single run, the `while` loop also does follow-ups: after the model
requests tools, the loop appends the tool results and **calls the model again**
with the grown `messages`. Each iteration is a follow-up turn.

```mermaid
sequenceDiagram
    participant Loop as runAgent
    participant Model
    participant Tool

    Note over Loop,Tool: One run - the multi-step loop
    loop until an assistant turn requests no tools
        Loop->>Model: stream(messages)
        Model-->>Loop: assistant + tool calls
        Loop->>Tool: execute(args)
        Tool-->>Loop: result
        Note over Loop: append assistant + result, then loop again
    end
    Note over Loop: assistant requests no tools = final answer, run ends
```

## Where state lives

The loop appends to `Memory` at three points per run — the new prompt, each
assistant turn, and the tool results — so after any run `Memory[sessionId]` is
the complete transcript, which is exactly what the next run loads.

Because continuity is entirely in `Memory`, follow-ups across **processes** (a
new request, a restart) work the same way *if the store is durable*.
`SessionMemoryStore` is in-RAM, so follow-ups persist within one process; swap in
a JSONL / Redis / Postgres `Memory` and the same `sessionId` resumes a
conversation later — with no loop changes.

> See also [`architecture.md`](./architecture.md) for the seam overview.
