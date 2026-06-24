/**
 * Layer B (durable bridge) — a web-standard SSE transport that runs `runAgent`
 * on the server and streams UI snapshots to the browser.
 *
 * Web-platform APIs only (Request/Response/ReadableStream/TextEncoder), so it
 * runs on Bun, Deno, Node 18+, and edge runtimes. Pair with a Layer-C client
 * that reads each `data:` frame as an `AgentSnapshot`.
 *
 * Coalescing model (the same one we whiteboarded):
 *  - the reducer ACCUMULATES deltas into state — no per-token work downstream;
 *  - a host-owned flush throttle (~30fps) decides WHEN to emit a snapshot frame;
 *  - structural events (tool start/end, message, end) flush eagerly, so ordering
 *    and responsiveness never wait behind the delta clock.
 *
 * Note we send *full snapshots*, so the reducer is the accumulator and a plain
 * throttle is all the coalescing we need. `BoundedBuffer` cap-1 coalesce earns
 * its place only when forwarding *deltas* to a rate-limited sink (fold many
 * deltas into one payload between flushes) — that is exactly what `ChannelBridge`
 * does. Different transport, different tool.
 */
import { AgentEventType, runAgent } from "@open-agent-loops/core";
import type { AgentEvent, RunAgentOptions } from "@open-agent-loops/core";
import { createSnapshotReducer } from "./agent-snapshot";

const FRAME_MS = 33; // ~30fps; the host owns this clock

const STRUCTURAL = new Set<AgentEventType>([
  AgentEventType.AgentStart,
  AgentEventType.TurnStart,
  AgentEventType.ToolStart,
  AgentEventType.ToolEnd,
  AgentEventType.Message,
  AgentEventType.MessageInjected,
  AgentEventType.AgentEnd,
]);

export interface RunAgentStreamOptions {
  /** Everything `runAgent` needs except `onEvent` — this transport supplies it. */
  run: Omit<RunAgentOptions, "onEvent">;
  /** Flush cadence in ms for the delta firehose. Default ~30fps. */
  frameMs?: number;
}

/**
 * Run `runAgent` and stream its evolving {@link import("./agent-snapshot").AgentSnapshot}
 * as Server-Sent Events. Returns a `Response` you can return straight from a
 * Bun/Deno/edge handler.
 *
 * @example
 * ```ts
 * // Bun
 * Bun.serve({
 *   port: 8787,
 *   async fetch(req) {
 *     const { prompt } = await req.json();
 *     return runAgentSSE({
 *       run: { model, memory, sessionId: "web", prompt, tools },
 *     });
 *   },
 * });
 * ```
 */
export function runAgentSSE(options: RunAgentStreamOptions): Response {
  const encoder = new TextEncoder();
  const frameMs = options.frameMs ?? FRAME_MS;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const reducer = createSnapshotReducer();
      let dirty = false;
      let closed = false;

      const send = () => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(reducer.snapshot())}\n\n`));
        dirty = false;
      };

      const timer = setInterval(() => {
        if (dirty) send();
      }, frameMs);

      const onEvent = (e: AgentEvent) => {
        reducer.apply(e);
        if (STRUCTURAL.has(e.type)) send(); // eager flush
        else dirty = true; //                   delta — let the clock flush it
      };

      void runAgent({ ...options.run, onEvent })
        .catch((err) => {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`),
          );
        })
        .finally(() => {
          send(); // guarantee a final frame with status: "done"
          clearInterval(timer);
          closed = true;
          controller.close();
        });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
