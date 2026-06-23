# Channels: a live transport with backpressure

Wire a long-lived, bursty channel (Slack/Discord) to the agent **without coupling
the socket to the model**. The transport drains continuously; a bounded,
coalescing queue protects the slow model. `runAgent` itself is unchanged.

```
socket ── ChannelSource ──→ Dispatcher ──→ runAgent
        (liveness/connect)   (bounded queue,   (unchanged)
                              coalesce, semaphore,
                              supersede)
        ChannelSource.send ←── ChannelBridge ←── events (TextDelta, coalesced)
```

- **`ChannelSource`** — the transport seam. Owns liveness only (heartbeat,
  reconnect, resume) and normalizes provider events into one `InboundMessage`.
- **`Dispatcher`** — the throttling layer: one in-flight run per session, a burst
  coalesced into a single prompt, a global concurrency cap, optional supersede.
- **`ChannelBridge`** — wires the two: inbound → `submit`, and a run's events →
  one coalesced reply per turn, routed back to the right thread.

## Run it (zero setup — no API key)

```bash
bun run examples/channels/channels.ts
```

It uses a latency-injecting echo model so backpressure is visible:

- **Burst** — 20 messages hit `#general` faster than a run can start. With
  `capacity: 4` + `drop-oldest`, the buffer keeps the last 4 and **sheds 16**; the
  survivors **coalesce into one run** → one reply
  `handled: msg 17 + msg 18 + msg 19 + msg 20`.
- **Steady** — a paced conversation on `#random` runs to completion and adds
  **zero** drops: the abusive burst can't starve a well-behaved thread.

`bridge.dispatcher.stats()` exposes the live readings — `queued`, `dropped`,
`highWater` — the signals an adaptive controller would act on (bounded ≠
adaptive: the buffer keeps you alive and *measurable*; tuning to load is a layer
on top).

## Make it real

Two swaps, no other changes:

1. **A real model** — replace `slowEchoModel(200)` with an
   `OpenAICompatibleModel({ apiKey, model, baseURL })`.
2. **A real transport** — implement `ChannelSource` (`start` / `send` / `stop`)
   over the Slack Events API or Discord gateway, normalizing each event into an
   `InboundMessage { channelId, threadId, userId, text }`, and pass it instead of
   `InMemoryChannelSource`. Heartbeat/reconnect live entirely in that class.

Tuning knobs on `ChannelBridge` (forwarded to the dispatcher): `capacity`,
`overflow` (`drop-oldest` / `drop-newest` / `block` / `{ coalesce }`),
`maxConcurrency`, `supersede`, and `sessionIdFor` (default: one session per
thread).
