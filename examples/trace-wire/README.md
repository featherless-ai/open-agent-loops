# Trace → over-the-wire timeline

The `Tracer` captures a run at three grains. `trace-timeline` shows the **agent**
grain — turns, messages, tool calls, and the streamed reasoning/text deltas. Those
deltas are the loop's *parse* of the response; they look SSE-ish but they aren't
the wire. This example drops to the lowest grain: the raw HTTP exchange.

| Grain | Seam | `format({ sources })` |
|---|---|---|
| agent | `tracer.sink` | `["agent"]` — turns, messages, tools, parsed deltas |
| model | `onRawRequest` | `["model"]` — the exact request body POSTed per turn |
| wire (response) | `onRawSSE` | `["sse"]` — the raw `data: {…}` lines streamed back |

Wiring **both** raw taps — `onRawRequest` (bytes out) and `onRawSSE` (bytes in) —
and filtering `format()` to `["model", "sse"]` gives the over-the-wire timeline:
a request marker per turn, interleaved with the raw SSE lines the server streamed.
Neither tap sees HTTP headers, so the API key is never captured.

## Run

```bash
cp .env.example .env   # at the repo root; fill in LLM_API_KEY and LLM_MODEL
bun run examples/trace-wire/trace-wire.ts
```

You'll see the agent stream its answer, then the over-the-wire timeline (request
markers + raw SSE lines), then the exact request body that went out each turn —
the request side of the wire, in full.

## Notes

- `format()` truncates long values (`maxValueLength`, default 80), so the
  `request_body` rows show a compact `body msgs=N tools=M` marker. The full bytes
  are printed separately from the captured bodies (and live in `toJSON()`).
- The raw SSE is the noisiest grain — one entry per `data:` line. Narrow with
  `sources` (`["sse"]` for just the response wire) or raise `maxValueLength` to
  read full lines.
- To turn a captured request body into a runnable curl, see
  [`../trace-to-curl`](../trace-to-curl). For the readable agent-grain timeline,
  see [`../trace-timeline`](../trace-timeline).
- `tracer.observe(model)` adds a fourth view between agent and wire: the *parsed*
  `StreamEvent`s plus a per-turn disclosure snapshot (`disclosure()`).
