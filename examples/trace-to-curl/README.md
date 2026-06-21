# Trace → curl

The `Tracer` taps both directions of the wire. The request side, `onRawRequest`,
captures the exact body the SDK POSTs each turn — model, `messages` (system
folded in, every assistant `tool_calls` block and `tool` result), `tools`, and
sampling params. Paired with `meta.baseURL` (seeded by `onRequest`), that's
everything needed to rebuild a runnable `curl` — the API key stays a
`$LLM_API_KEY` placeholder and is never captured.

This example runs a one-shot agent with a `weather` tool, then prints a curl for
every model turn. Each later turn's body carries the growing tool-call history,
so its curl replays exactly what the model saw.

## Run

```bash
cp .env.example .env   # at the repo root; fill in LLM_API_KEY and LLM_MODEL
bun run examples/trace-to-curl/trace-to-curl.ts
```

You'll see the agent stream its answer (calling `weather` for each city), then a
`curl` per turn. The body is pretty-printed by default (single quotes preserve the
newlines, so it stays runnable). Paste one to replay that exact call:

```bash
curl -N https://api.featherless.ai/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -d '{
  "model": "...",
  "messages": [ ... ],
  "tools": [ ... ],
  "stream": false
}'
```

## Notes

- The body is pretty-printed for readability; pass `pretty: false` to `toCurl`
  for a compact one-liner (handy for scripting or `-d @body.json`).
- The printed curls set `stream: false` for a single readable JSON response.
  Drop that to stream SSE back (the captured body has `stream: true`).
- Bodies are single-quoted for the shell; a literal `'` inside message content
  is escaped as `'\''`. For very large multi-turn bodies, prefer writing the
  body to a file and using `-d @body.json`.
- Add `onRawSSE: tracer.onRawSSE` to also capture the response wire, and
  `tracer.observe(model)` for per-turn disclosure snapshots and stream events.
