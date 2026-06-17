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

/**
 * How many queued messages a {@link MessageQueue.drain | drain} releases:
 * `"one-at-a-time"` (the oldest single message) or `"all"` (every queued
 * message). Mirrors pi's `steeringMode` / `followUpMode`.
 *
 * @group Core
 */
export type DrainMode = "one-at-a-time" | "all";

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
 * A FIFO queue of {@link Message}s for the loop's steering / follow-up seams.
 *
 * @remarks
 * Pure and host-agnostic: no timers, no I/O. {@link drain} returns messages in
 * the order they were pushed and removes what it returns, so it plugs straight
 * into {@link Hooks.drainSteering} / {@link Hooks.drainFollowUp} — which expect
 * exactly "the messages to inject now, having consumed them".
 *
 * @group Core
 */
export class MessageQueue {
  private readonly items: Message[] = [];

  /** Drain policy — mutable so a caller can switch one-at-a-time/all at runtime. */
  mode: DrainMode;

  /**
   * @param options - Drain policy; see {@link MessageQueueOptions}.
   */
  constructor(options: MessageQueueOptions = {}) {
    this.mode = options.mode ?? "one-at-a-time";
  }

  /** Number of messages currently queued. */
  get size(): number {
    return this.items.length;
  }

  /**
   * Enqueue one or more messages at the back of the queue.
   *
   * @param messages - The message(s) to queue, in order.
   */
  push(...messages: Message[]): void {
    this.items.push(...messages);
  }

  /**
   * Remove and return queued messages per {@link mode}: the single oldest
   * message for `"one-at-a-time"`, or every queued message for `"all"`. Returns
   * an empty array when the queue is empty — so it is safe to pass directly as a
   * drain hook (an empty result leaves the run as-is).
   *
   * @returns The drained messages in FIFO order.
   */
  drain(): Message[] {
    if (this.items.length === 0) return [];
    if (this.mode === "all") return this.items.splice(0);
    return this.items.splice(0, 1);
  }

  /** Drop every queued message. */
  clear(): void {
    this.items.length = 0;
  }
}
