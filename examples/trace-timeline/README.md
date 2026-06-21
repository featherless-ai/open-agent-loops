# Trace → full timeline

A `Tracer` is a passive observer: it rides the seams the loop already exposes, so
the run never knows it's there. Wire the event sink and the request taps and every
captured item becomes one timestamped entry in a single ordered timeline —
`tracer.entries`. From that one timeline you pick a lens:

- `format()` — the full timeline, one entry per line, with `+dt` offsets and a
  metadata header (model, baseURL, system, tools).
- `format({ sources })` — the same timeline narrowed to a grain (`agent`,
  `model`, `sse`).
- `toJSONL()` — one compact JSON object per line, for storage or tooling.
- `toJSON()` — the timeline bundled with the run's `meta` as a single document.

This example runs a one-shot agent with a `weather` tool, then prints the full
timeline, prints the agent-only view, and writes the whole trace to `trace.jsonl`.

## Run

```bash
cp .env.example .env   # at the repo root; fill in LLM_API_KEY and LLM_MODEL
bun run examples/trace-timeline/trace-timeline.ts
```

You'll see the agent stream its answer (calling `weather` for each city), then the
full timeline — `agent_start`, each `turn_start`, the streamed reasoning/text
deltas, `tool_start` / `tool_end`, the captured `request_body` per turn, and
`agent_end` — followed by a line confirming the trace was written to disk.

## Notes

- The timeline includes per-token `reasoning`/`text` deltas, so it can be long.
  Pass `maxValueLength` to clip long values, or `sources` to drop a grain.
- `request_body` entries render compactly in `format()` (`body msgs=N tools=M`);
  the full bodies are in the JSON. Turn any one into a runnable curl with `toCurl`
  — see [`../trace-to-curl`](../trace-to-curl).
- Add `onRawSSE: tracer.onRawSSE` to also capture the raw response wire (the
  noisiest grain — filter it with `format({ sources: ["agent", "model"] })`), and
  `tracer.observe(model)` for parsed stream events plus per-turn disclosure
  snapshots (`disclosure()` / `formatDisclosure()`).
- For long-lived runs, pass `{ write }` to the `Tracer` to stream entries to a
  file off the hot path instead of building the JSONL in memory at the end.
