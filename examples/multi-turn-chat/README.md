# Multi-turn chat loop

The same `runAgent` call as the single-turn loop, wrapped in a read-input loop
that reuses one `memory` + `sessionId` — so every turn remembers the ones before
it. Multi-turn isn't special-cased: `runAgent` loads history at the start of each
run and writes the new turn back.

## Run

```bash
cp .env.example .env   # at the repo root; fill in LLM_API_KEY and LLM_MODEL
bun run examples/multi-turn-chat/multi-turn-chat.ts
```

Chat at the `you ›` prompt. Ask a follow-up ("and in London?") to see it carry
context across turns. Type `exit` or an empty line to quit.
