# secret-hello-skill — a credential-gated binary skill

A worked example of the [skills design](../../agent-core/docs/skills.md): a skill
that is **pure instructions** driving the shared `shell` tool to run a real
binary that **refuses to work without a credential**.

It extends [`multi-turn-chat`](../multi-turn-chat/multi-turn-chat.ts): the same
read-input loop over one reused `memory` + `sessionId`, plus a skill and a
credential-wrapped shell tool.

## The pieces

- [`../bin/secret-hello`](../bin/secret-hello) — a toy CLI that greets you, but
  only if `SECRET_HELLO_TOKEN` holds the right key. Wrong/absent token → exits
  non-zero. This is the "simple binary you can only access with the credential."
- The `secret-hello` skill — instructions only, no tools of its own. It tells the
  model to run `SECRET_HELLO_TOKEN={{secret_hello_token}} ./secret-hello "<name>"`.
- `withCredentials(shellTool(...))` — swaps `{{secret_hello_token}}` for the real
  secret at execution time, then scrubs it from the result. The model and the
  transcript only ever see the placeholder.

## Run it

```sh
cp .env.example .env   # fill in LLM_API_KEY (and optionally LLM_MODEL)
bun run examples/secret-hello-skill/secret-hello-skill.ts
# you › say hi to Ada
```

The model reads the catalog, calls `skill({ name: "secret-hello" })` to load the
recipe, then runs the command — the binary sees the real token via env (swapped
in from the placeholder) and greets. Drop the placeholder and the binary refuses.

## See it gated, no model needed

The end-to-end credential gating is also covered by a network-free test:

```sh
bun test agent-core/__tests__/skills-binary.test.ts
```
