/**
 * A small FIFO queue of messages a caller can feed into a live run through the
 * loop's {@link Hooks.drainSteering | drainSteering} /
 * {@link Hooks.drainFollowUp | drainFollowUp} pull-seams.
 *
 * The loop never owns input — it only *pulls* at its boundaries. This is the
 * battery for the queue the caller owns: `push` from whatever non-blocking
 * source feeds it (a keypress handler, a websocket, a supervisor), and pass
 * {@link MessageQueue.drain | drain} as the hook. The {@link DrainMode}
 * (`"one-at-a-time"` vs `"all"`) is pi's `steeringMode`/`followUpMode`, and
 * {@link MessageQueue.clear | clear} is its `clear*Queue` — the whole config
 * surface, caller-owned, with the loop kernel left untouched.
 *
 * @example
 * ```ts
 * const steering = new MessageQueue();
 * // ...from a non-blocking input source, while a run is in flight:
 * steering.push(userMessage({ content: "actually, do B instead" }));
 *
 * await runAgent({
 *   model, memory, sessionId, prompt, tools,
 *   hooks: { drainSteering: () => steering.drain() },
 * });
 * ```
 *
 * @module
 */

import type { Message } from "../types";
import { BoundedBuffer } from "./bounded-buffer";
import type { DrainMode } from "./bounded-buffer";

export type { DrainMode };

/**
 * Options for a {@link MessageQueue}.
 *
 * @group Core
 */
export interface MessageQueueOptions {
  /** Drain policy. Default `"one-at-a-time"`. */
  mode?: DrainMode;
}

/**
 * A FIFO queue of {@link Message}s for the loop's steering / follow-up seams —
 * the unbounded specialization of {@link BoundedBuffer} (`capacity: Infinity`),
 * so the overflow policy never engages and it behaves as a plain FIFO.
 *
 * @remarks
 * Pure and host-agnostic: no timers, no I/O. {@link BoundedBuffer.drain | drain}
 * returns messages in the order they were pushed and removes what it returns, so
 * it plugs straight into {@link Hooks.drainSteering} / {@link Hooks.drainFollowUp}
 * — which expect exactly "the messages to inject now, having consumed them".
 *
 * Reach for {@link BoundedBuffer} directly when you need a cap and an overflow
 * policy — e.g. a live-ingress dispatcher queue or outbound reply coalescing.
 *
 * @group Core
 */
export class MessageQueue extends BoundedBuffer<Message> {
  /**
   * @param options - Drain policy; see {@link MessageQueueOptions}.
   */
  constructor(options: MessageQueueOptions = {}) {
    super({ capacity: Infinity, overflow: "block", mode: options.mode });
  }
}
