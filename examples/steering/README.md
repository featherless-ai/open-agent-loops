# Steering and follow-up

Two ways to feed messages into a run that is *already in flight*:

- **steering** — redirect the agent mid-task. The message is drained after the
  current tool batch (so `tool_use`/`tool_result` pairing stays intact) and the
  next turn sees it. It overrides a tool's `terminate` and a `stopWhen`, but never
  the `maxSteps` cap.
- **follow-up** — extend the run past its natural final answer. The message is
  drained when the agent would otherwise stop, and another turn runs.

The loop never owns input — it only *pulls* at its boundaries via the
`drainSteering` / `drainFollowUp` hooks. The caller owns the queue
(`MessageQueue`) and feeds it from a **non-blocking** source. That's the crux: a
blocking `await rl.question(...)` loop can't steer, because it can't read input
while a run is underway. This example attaches a `'line'` listener that pushes
typed lines into the queue while `runAgent` runs concurrently.

Keeping it one continuous run (rather than aborting and re-running) is also what
keeps the trace a single `agent_start → agent_end` with monotonic steps — the
`Tracer` folds each injected turn onto the step it followed, so the redirect shows
up in `formatTrajectory()` as `↪ steering: ...`, not just the raw timeline.

## Run

```bash
cp .env.example .env   # at the repo root; fill in LLM_API_KEY and LLM_MODEL
bun run examples/steering/steering.ts
```

Ask for something with a step ("research penguins, then summarize"). While the
slow `research` tool is running (~3s), type a redirect and press enter — e.g.
"actually, make it about otters". The trajectory printed at the end shows it
folded in.
