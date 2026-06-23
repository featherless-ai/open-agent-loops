/**
 * Runnable example: wire a live channel to the agent with backpressure.
 *
 * This is the "set it up" example for channels. It connects an
 * `InMemoryChannelSource` (stand-in for a Slack/Discord socket) to a
 * `ChannelBridge`, which owns a `Dispatcher` in front of `runAgent`. The whole
 * point: the transport drains continuously while the (slow) model is protected by
 * a bounded, coalescing queue — `runAgent` itself is untouched.
 *
 * It runs with **zero setup** — no API key — by standing in a latency-injecting
 * "echo" model so the backpressure is visible. To make it real, swap two lines
 * (see the README): a real `OpenAICompatibleModel` and a real `ChannelSource`.
 *
 * Run it:
 *   bun run examples/channels/channels.ts
 */

import {
  assistantMessage,
  ChannelBridge,
  contentToText,
  InMemoryChannelSource,
  Role,
  SessionMemoryStore,
  StreamEventType,
} from "../../agent-core/index.ts";
import type { ModelClient, ModelRequest } from "../../agent-core/index.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A stand-in model with latency: inbound messages pile up while a run is in
// flight, which is what makes backpressure observable. It echoes the user turns
// it actually received, so you can see which messages survived the buffer.
function slowEchoModel(latencyMs: number): ModelClient {
  return {
    async *stream(request: ModelRequest) {
      await sleep(latencyMs);
      const received = request.messages
        .filter((m) => m.role === Role.User)
        .map((m) => contentToText(m.content))
        .join(" + ");
      const reply = `handled: ${received}`;
      for (const piece of reply.match(/.{1,12}/g) ?? []) {
        yield { type: StreamEventType.TextDelta, text: piece };
      }
      yield { type: StreamEventType.Done, message: assistantMessage({ content: reply }) };
    },
  };
}

const source = new InMemoryChannelSource();
const bridge = new ChannelBridge({
  source,
  base: { model: slowEchoModel(200), memory: new SessionMemoryStore() },
  capacity: 4, // small, so shedding is easy to see
  overflow: "drop-oldest", // under live ingress, stale context is cheapest to lose
  maxConcurrency: 2, // at most 2 runs in flight across all threads
});
await bridge.start();

// --- Scenario 1: a tight burst to one thread ----------------------------------
// 20 messages arrive faster than a run can even start. The bounded buffer keeps
// the last `capacity` (4) and sheds the rest; the survivors coalesce into ONE run.
console.log("→ burst: 20 messages to #general  (capacity 4, drop-oldest)\n");
for (let i = 1; i <= 20; i++) {
  source.emit({ channelId: "#general", threadId: "t-general", userId: "u-spammer", text: `msg ${i}` });
}
console.log("  right after the burst:", bridge.dispatcher.stats());

await sleep(700); // let the slow run drain
console.log("  after draining:     ", bridge.dispatcher.stats());
console.log("  reply posted back:  ", source.sent.map((s) => s.text));
console.log("  → 16 shed, 4 survivors folded into 1 run, 1 reply.\n");

// --- Scenario 2: a well-behaved thread is unaffected --------------------------
// A paced conversation on a different thread runs to completion; the global drop
// count does NOT grow — the abusive burst couldn't starve this thread.
const droppedBefore = bridge.dispatcher.stats().dropped;
console.log("→ steady: 5 paced messages to #random  (stays under capacity)\n");
for (let i = 1; i <= 5; i++) {
  source.emit({ channelId: "#random", threadId: "t-random", userId: "u-regular", text: `q${i}` });
  await sleep(120);
}
await sleep(700);

const stats = bridge.dispatcher.stats();
const randomReplies = source.sent.filter((s) => s.target.threadId === "t-random").map((s) => s.text);
console.log("  replies posted back:", randomReplies);
console.log(`  drops added by #random: ${stats.dropped - droppedBefore}  (well-behaved → none)`);
console.log("  final stats:        ", stats);

await bridge.stop();
