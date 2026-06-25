/**
 * Durable bridge — a web-standard SSE transport that runs `runAgent` and streams
 * UI snapshots. Copied from the `agent-loop-react-ui` skill (relative imports for
 * the repo).
 *
 * Reducer accumulates; a host-owned ~30fps throttle decides when to emit; and
 * structural events (tool start/end, message, end) flush eagerly so ordering and
 * responsiveness never wait behind the delta clock.
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

/** Run `runAgent` and stream its evolving `AgentSnapshot` as Server-Sent Events. */
export function runAgentSSE(options: RunAgentStreamOptions): Response {
  const encoder = new TextEncoder();
  const frameMs = options.frameMs ?? FRAME_MS;

  // Abort the run if the consumer goes away (client disconnect / idle timeout),
  // so we stop calling the model for a stream nobody is reading.
  const ac = new AbortController();
  let teardown = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const reducer = createSnapshotReducer();
      let dirty = false;
      let closed = false;
      let timer: ReturnType<typeof setInterval>;

      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        ac.abort();
      };
      teardown = stop;

      const send = () => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(reducer.snapshot())}\n\n`));
          dirty = false;
        } catch {
          stop(); // controller closed externally — stop sending, don't crash
        }
      };

      timer = setInterval(() => {
        if (dirty) send();
      }, frameMs);

      const onEvent = (e: AgentEvent) => {
        reducer.apply(e);
        if (STRUCTURAL.has(e.type)) send();
        else dirty = true;
      };

      void runAgent({ ...options.run, onEvent, signal: options.run.signal ?? ac.signal })
        .catch((err) => {
          if (closed) return; // aborted by disconnect — nothing to report
          try {
            controller.enqueue(
              encoder.encode(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`),
            );
          } catch {
            /* already closed */
          }
        })
        .finally(() => {
          send(); // final frame (status: done)
          stop();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
    },
    cancel() {
      teardown(); // consumer disconnected
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
