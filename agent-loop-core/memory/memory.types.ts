/**
 * The plug-and-play memory seam for the agent loop.
 *
 * @remarks
 * The loop reads context and appends turns through this interface only — it has
 * no idea whether messages live in RAM, on disk, in Redis, or behind a vector
 * index. Swap the implementation, keep the loop untouched.
 *
 * v1 ships a single ephemeral store ({@link SessionMemoryStore} in
 * `./session-memory`); durable backends (JSONL, Redis, vector) are future
 * implementations of this same interface.
 *
 * @module
 */

import type { Message } from "../types";

/**
 * Persistence seam for per-session message history.
 *
 * @remarks
 * Implementations may be ephemeral or durable; the loop depends only on this
 * contract. See {@link SessionMemoryStore} for the v1 RAM-only implementation.
 *
 * @see {@link MemoryListener} for observing a `Memory` without altering it.
 * @group Memory
 */
export interface Memory {
  /**
   * Return the full message history for a session (oldest first).
   * @param sessionId - Identifier of the session to load.
   * @returns The session's messages, or an empty array if the session is unknown.
   */
  load(sessionId: string): Promise<Message[]>;
  /**
   * Append one or more messages to a session's history.
   * @param sessionId - Identifier of the session to append to.
   * @param messages - Messages to store, in order.
   */
  append(sessionId: string, messages: Message[]): Promise<void>;
  /**
   * Drop a session's history entirely.
   * @param sessionId - Identifier of the session to clear.
   */
  clear(sessionId: string): Promise<void>;
}

/**
 * Observe a {@link Memory} without changing its behavior.
 *
 * @remarks
 * Each callback fires *after* the underlying operation succeeds, so it sees
 * exactly what happened. Attach with `withMemoryListeners` (in `../compose`) —
 * pure composition, no subclassing. Listeners react (log, meter, warm caches);
 * they cannot alter results — for that, wrap the seam with a transforming
 * decorator instead.
 *
 * @see {@link Memory}
 * @group Memory
 */
export interface MemoryListener {
  /**
   * Fired after a load, with the messages that were returned.
   * @param sessionId - The session that was loaded.
   * @param messages - The messages returned by the load.
   */
  onLoad?(sessionId: string, messages: Message[]): void | Promise<void>;
  /**
   * Fired after an append, with the messages that were stored.
   * @param sessionId - The session that was appended to.
   * @param messages - The messages that were stored.
   */
  onAppend?(sessionId: string, messages: Message[]): void | Promise<void>;
  /**
   * Fired after a session is cleared.
   * @param sessionId - The session that was cleared.
   */
  onClear?(sessionId: string): void | Promise<void>;
}
