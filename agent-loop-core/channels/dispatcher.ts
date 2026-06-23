/**
 * A session-keyed dispatcher: the layer in front of {@link runAgent} that turns
 * a continuous, bursty stream of inbound messages into discrete, rate-controlled
 * runs — without coupling the fast transport side to the slow model side.
 *
 * It owns four jobs, and `runAgent` itself does not change:
 *
 * 1. **Per-session serialization** — at most one in-flight run per `sessionId`.
 *    Two concurrent runs on one session would interleave their `memory.append`
 *    calls and corrupt history, so each session pumps one run at a time.
 * 2. **Coalescing** — a burst of messages that arrives while a run is in flight
 *    accumulates in that session's {@link BoundedBuffer} and is folded into a
 *    single `Message[]` prompt for the next run. The in-flight run *is* the
 *    debounce window, so no timer is needed.
 * 3. **Global concurrency cap** — a pure-JS semaphore bounds how many runs are
 *    in flight across *all* sessions, protecting the provider rate limit.
 * 4. **Supersede (optional)** — a newer message can abort the in-flight run via
 *    its `AbortSignal` instead of queueing behind it, so model calls aren't spent
 *    finishing stale context.
 *
 * Dependency-free: the only external it touches is the standard `AbortController`
 * global. Time is never owned here.
 *
 * @module
 */

import { runAgent } from "../primitives/loop";
import { BoundedBuffer } from "../primitives/bounded-buffer";
import type { EventSink, Message } from "../types";
import type { DispatcherOptions, RunFn } from "./dispatcher.types";

/** Aggregate backpressure readings across all of a {@link Dispatcher}'s sessions. */
export interface DispatcherStats {
  /** Number of sessions the dispatcher is tracking. */
  sessions: number;
  /** Runs currently in flight across all sessions. */
  inFlight: number;
  /** Messages currently queued across all sessions, awaiting a run. */
  queued: number;
  /** Total messages dropped (overflow) across all sessions, lifetime. */
  dropped: number;
  /** Largest single-session queue depth ever reached — the backpressure peak. */
  highWater: number;
}

/**
 * A counting semaphore that hands a freed slot *directly* to the next waiter
 * (rather than decrement-then-let-anyone-reacquire), so a synchronous
 * `acquire()` racing a `release()` can never over-subscribe past `max`.
 */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  /** Runs currently holding a slot. */
  get inFlight(): number {
    return this.active;
  }

  /** Take a slot, waiting if all `max` are held. */
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    // Park until a release hands us the slot — no increment on resume, the slot
    // was passed to us directly.
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  /** Release a slot — handed to the next waiter if any, else freed. */
  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next(); // slot stays "active", just changes owner
    } else {
      this.active -= 1;
    }
  }
}

/** Per-session state: its inbound buffer, whether it is being pumped, and the
 * in-flight run's controller (for supersede). */
interface SessionState {
  buffer: BoundedBuffer<Message>;
  pumping: boolean;
  controller?: AbortController;
}

/**
 * Turns `submit(sessionId, message)` calls into throttled {@link runAgent} runs.
 * See the {@link module:channels/dispatcher | module docs} for the model.
 *
 * @group Channels
 */
export class Dispatcher {
  private readonly sessions = new Map<string, SessionState>();
  private readonly semaphore: Semaphore;
  private readonly run: RunFn;

  constructor(private readonly options: DispatcherOptions) {
    this.semaphore = new Semaphore(options.maxConcurrency ?? 4);
    this.run = options.run ?? runAgent;
  }

  /** Runs currently in flight across all sessions. */
  get inFlight(): number {
    return this.semaphore.inFlight;
  }

  /** Aggregate backpressure readings — what an adaptive controller acts on. */
  stats(): DispatcherStats {
    let queued = 0;
    let dropped = 0;
    let highWater = 0;
    for (const session of this.sessions.values()) {
      queued += session.buffer.size;
      dropped += session.buffer.dropped;
      highWater = Math.max(highWater, session.buffer.highWater);
    }
    return { sessions: this.sessions.size, inFlight: this.inFlight, queued, dropped, highWater };
  }

  /**
   * Enqueue one or more messages for a session and ensure it is being pumped.
   * Non-blocking: always returns immediately so the caller (a socket handler)
   * can keep draining its transport. Backpressure is applied at the buffer, never
   * here.
   *
   * @param sessionId - The session/thread the messages belong to.
   * @param messages - The inbound message(s).
   */
  submit(sessionId: string, ...messages: Message[]): void {
    const session = this.sessionFor(sessionId);
    session.buffer.push(...messages);
    if (this.options.supersede && session.controller) {
      // A newer message supersedes the in-flight run; cancel it. Its prompt is
      // already persisted to memory, so nothing is lost — the next run loads it.
      session.controller.abort();
    }
    void this.pump(sessionId);
  }

  /**
   * The `onEvent` for a run: forwards to the session-blind `base.onEvent` and,
   * if set, the session-aware `onSessionEvent` (tagged with `sessionId`). Returns
   * `base.onEvent` unchanged when no session sink is set, so behavior is
   * identical for non-channel callers.
   */
  private onEventFor(sessionId: string): EventSink | undefined {
    const baseOnEvent = this.options.base.onEvent;
    const onSessionEvent = this.options.onSessionEvent;
    if (!onSessionEvent) return baseOnEvent;
    return async (event) => {
      await baseOnEvent?.(event);
      onSessionEvent(sessionId, event);
    };
  }

  /** Get or lazily create a session's state. */
  private sessionFor(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        buffer: new BoundedBuffer<Message>({
          capacity: this.options.capacity ?? 64,
          overflow: this.options.overflow ?? "drop-oldest",
          mode: "all", // drain folds the whole backlog into one coalesced prompt
        }),
        pumping: false,
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  /**
   * Drive a session's runs one at a time until its buffer is empty. Guarded by
   * `pumping` so only one pump loop exists per session (serialization). Each
   * iteration takes a global slot, coalesces the backlog, and runs once.
   */
  private async pump(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.pumping) return;
    session.pumping = true;
    try {
      while (session.buffer.size > 0) {
        await this.semaphore.acquire();
        const batch = session.buffer.drain(); // mode "all" → the whole backlog
        const controller = new AbortController();
        session.controller = controller;
        try {
          await this.run({
            ...this.options.base,
            sessionId,
            prompt: batch,
            signal: controller.signal,
            onEvent: this.onEventFor(sessionId),
          });
        } catch (error) {
          // A supersede abort is expected — swallow it; the newer messages are
          // already queued and the loop picks them up. Any other error is the
          // caller's to observe; one bad run must not kill the dispatcher.
          if (!controller.signal.aborted) this.options.onError?.(error, sessionId);
        } finally {
          session.controller = undefined;
          this.semaphore.release();
        }
        // Late arrivals during the awaited run are caught by the while re-check.
      }
    } finally {
      session.pumping = false;
    }
  }
}
