/**
 * Channels tutorial — connect a live transport to the agent, with backpressure.
 *
 * Runs with zero setup (no API key): an in-memory channel and a tiny echo model
 * stand in for a real socket and a real LLM, so the backpressure mechanics are
 * visible on their own.
 *
 *   bun run examples/channels-tutorial/step1.ts
 */

// #region step1
import {
  assistantMessage,
  ChannelBridge,
  contentToText,
  InMemoryChannelSource,
  Role,
  SessionMemoryStore,
  StreamEventType,
} from "../../agent-loop-core/index.ts";
import type { ModelClient, ModelRequest } from "../../agent-loop-core/index.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A stand-in model with latency: inbound messages pile up while a run is in
// flight, which is what makes backpressure observable. It echoes the (coalesced)
// user turns it actually received, so you can see which messages survived.
const echoModel: ModelClient = {
  async *stream(request: ModelRequest) {
    await sleep(150);
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

// The transport. A real bot swaps in a Slack/Discord ChannelSource here — the
// rest of the wiring is identical, because the transport is just a seam.
const source = new InMemoryChannelSource();

// The bridge wires the transport to runAgent through a bounded, coalescing queue.
const bridge = new ChannelBridge({
  source,
  base: { model: echoModel, memory: new SessionMemoryStore() },
  capacity: 4, // per-thread spam ceiling
  overflow: "drop-oldest", // shed the stalest message under a flood
  maxConcurrency: 2, // at most 2 runs across all threads
});
await bridge.start();

// A burst: 10 messages to one thread, faster than a run can even start. The
// bounded buffer keeps the last 4 and sheds the rest; the survivors coalesce
// into ONE run, and its reply is posted back to the originating thread.
for (let i = 1; i <= 10; i++) {
  source.emit({ channelId: "#general", threadId: "t1", userId: "u", text: `msg ${i}` });
}
console.log("right after the burst:", bridge.dispatcher.stats());

await sleep(400); // let the slow run finish
console.log("reply posted back:    ", source.sent.map((s) => s.text));
console.log("final stats:          ", bridge.dispatcher.stats());

await bridge.stop();
// #endregion step1
