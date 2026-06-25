/**
 * Layer C (UI-library adapter) — the ONLY file that imports the UI library.
 *
 * Pinned to @assistant-ui/react@0.14.x (verified June 2026). assistant-ui's
 * runtime API moves; before trusting this, confirm `useLocalRuntime` +
 * `ChatModelAdapter` against the current docs:
 *   https://www.assistant-ui.com/docs/runtimes/custom/local-runtime
 *
 * This wires a LocalRuntime ChatModelAdapter to agent-loop-core. It runs the
 * agent CLIENT-SIDE with the MockModelClient — no backend, no API key — so you
 * can see streaming immediately. To go live, swap to the SSE transport: see the
 * README ("Go live").
 *
 * The key contract (verified verbatim from the docs): the adapter is an async
 * generator and **each yield replaces the previous content — yield the FULL
 * accumulated state, not deltas.** Our snapshot reducer already accumulates, so
 * we just yield `current.text` each time.
 */
import type { ChatModelAdapter } from "@assistant-ui/react";
import { runAgent, SessionMemoryStore } from "@open-agent-loops/core";
import { MockModelClient } from "@open-agent-loops/core/mocks/mock-model";
import type { AgentEvent } from "@open-agent-loops/core";
// Copy the durable bridge from the skill's assets/bridge/ into your src/.
import { createSnapshotReducer } from "./agent-snapshot";

/** Turn the push-based `onEvent` callback into a pull-based async iterator. */
function eventChannel() {
  const queue: AgentEvent[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  return {
    push(event: AgentEvent) {
      queue.push(event);
      wake?.();
      wake = null;
    },
    finish() {
      done = true;
      wake?.();
      wake = null;
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
      while (true) {
        if (queue.length) {
          yield queue.shift()!;
          continue;
        }
        if (done) return;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}

/** Pull the latest user text out of assistant-ui's message list. */
function lastUserText(messages: readonly { role: string; content: readonly unknown[] }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    return (m.content as Array<{ type?: string; text?: string }>)
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
  }
  return "";
}

// One memory store across turns → the conversation remembers itself.
const memory = new SessionMemoryStore();

export const agentAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const prompt = lastUserText(messages as never);
    const channel = eventChannel();
    const reducer = createSnapshotReducer();

    // NO BACKEND: a deterministic streaming model so the demo runs with zero
    // setup. Replace with OpenAICompatibleModel behind the SSE transport to go
    // live (see README).
    const model = new MockModelClient(() => ({
      reasoning: "Reading the request…",
      text: `(agent-loop demo) You said: "${prompt}". This reply streamed through the snapshot bridge.`,
    }));

    const finished = runAgent({
      model,
      memory,
      sessionId: "assistant-ui-demo",
      prompt,
      signal: abortSignal,
      onEvent: (event) => channel.push(event),
    }).finally(() => channel.finish());

    for await (const event of channel) {
      reducer.apply(event);
      const snap = reducer.snapshot();
      // Accumulated content, not deltas — assistant-ui diffs it for us.
      yield { content: [{ type: "text", text: snap.current.text }] };
    }
    await finished; // surface any run error to the runtime
  },
};
