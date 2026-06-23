/**
 * Types for the {@link Dispatcher} — the throttling layer that turns a
 * continuous stream of inbound messages into discrete, rate-controlled
 * `runAgent` calls.
 *
 * @module
 */

import type { Message } from "../types";
import type { RunAgentOptions, RunResult } from "../primitives/loop";
import type { OverflowPolicy } from "../primitives/bounded-buffer";

/**
 * The per-run configuration shared across every session the dispatcher drives —
 * everything {@link runAgent} needs *except* the per-call `sessionId`, `prompt`,
 * and `signal`, which the dispatcher supplies itself.
 *
 * @group Channels
 */
export type DispatcherRunBase = Omit<RunAgentOptions, "sessionId" | "prompt" | "signal">;

/**
 * How the dispatcher executes one run. Defaults to {@link runAgent}; injectable
 * so tests can drive it with a controllable fake instead of a real model.
 *
 * @group Channels
 */
export type RunFn = (options: RunAgentOptions) => Promise<RunResult>;

/**
 * Options for a {@link Dispatcher}.
 *
 * @group Channels
 */
export interface DispatcherOptions {
  /** Shared run config (model, memory, tools, system, onEvent, hooks, …). */
  base: DispatcherRunBase;
  /**
   * Per-session inbound buffer capacity — the spam ceiling for one session.
   * Default `64`.
   */
  capacity?: number;
  /**
   * What happens to an inbound message when a session's buffer is full. Default
   * `"drop-oldest"` (stale context is the cheapest to lose under live ingress).
   */
  overflow?: OverflowPolicy<Message>;
  /**
   * Max runs in flight across *all* sessions — the global protection for the
   * model / provider rate limit. Excess waits. Default `4`.
   */
  maxConcurrency?: number;
  /**
   * When `true`, a newly submitted message aborts the in-flight run for that
   * session (supersede) rather than letting it finish and queueing behind it.
   * Safe because `runAgent` persists the prompt to memory before its first abort
   * check, so a superseded run's messages survive in history. Default `false`.
   */
  supersede?: boolean;
  /** Override how runs execute (for tests). Default {@link runAgent}. */
  run?: RunFn;
  /**
   * Called when a run rejects for a reason *other* than a supersede abort.
   * Without it, such an error is swallowed (a single bad run must not kill the
   * dispatcher).
   */
  onError?: (error: unknown, sessionId: string) => void;
}
