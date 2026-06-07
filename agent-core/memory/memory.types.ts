/**
 * The plug-and-play memory seam. The loop reads context and appends turns
 * through this interface only — it has no idea whether messages live in RAM,
 * on disk, in Redis, or behind a vector index. Swap the implementation, keep
 * the loop untouched.
 *
 * v1 ships a single in-memory store (`InMemoryStore` in `./memory`); durable
 * backends (JSONL, Redis, vector) are future implementations of this same
 * interface.
 */

import type { Message } from "../types";

export interface Memory {
  /** Return the full message history for a session (oldest first). */
  load(sessionId: string): Promise<Message[]>;
  /** Append one or more messages to a session's history. */
  append(sessionId: string, messages: Message[]): Promise<void>;
  /** Drop a session's history entirely. */
  clear(sessionId: string): Promise<void>;
}

/**
 * Observe a `Memory` without changing its behavior. Each callback fires *after*
 * the underlying operation succeeds, so it sees exactly what happened. Attach
 * with `withMemoryListeners` (in `../compose`) — pure composition, no
 * subclassing. Listeners react (log, meter, warm caches); they cannot alter
 * results — for that, wrap the seam with a transforming decorator instead.
 */
export interface MemoryListener {
  /** Fired after a load, with the messages that were returned. */
  onLoad?(sessionId: string, messages: Message[]): void | Promise<void>;
  /** Fired after an append, with the messages that were stored. */
  onAppend?(sessionId: string, messages: Message[]): void | Promise<void>;
  /** Fired after a session is cleared. */
  onClear?(sessionId: string): void | Promise<void>;
}
