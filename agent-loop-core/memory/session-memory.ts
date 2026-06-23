/**
 * The v1 implementation of the {@link Memory} seam: an ephemeral, RAM-only
 * session store.
 *
 * @remarks
 * Backed by a Map of sessionId -> messages. History lives for the lifetime of
 * the process and is gone on restart; durable backends (JSONL, Redis, vector)
 * implement the same interface.
 *
 * Defensive copying is deliberate. `load` returns a fresh array of cloned
 * messages and `append` clones on the way in, so callers can never mutate
 * stored history by holding a reference — the same guarantee a real
 * (serializing) backend would give for free.
 *
 * @example
 * ```ts
 * const memory = new SessionMemoryStore();
 * await memory.append("session-1", [
 *   { role: Role.User, content: "hello", timestamp: Date.now() },
 * ]);
 * const history = await memory.load("session-1"); // -> [{ role: "user", ... }]
 * await memory.clear("session-1");
 * ```
 *
 * @see {@link Memory}
 * @group Memory
 * @module
 */

import type { Message } from "../types";
import type { Memory } from "./memory.types";

export class SessionMemoryStore implements Memory {
  private readonly sessions = new Map<string, Message[]>();

  /**
   * Return the full message history for a session (oldest first).
   * @param sessionId - Identifier of the session to load.
   * @returns A fresh array of cloned messages; empty if the session is unknown.
   */
  async load(sessionId: string): Promise<Message[]> {
    const stored = this.sessions.get(sessionId) ?? [];
    return stored.map(cloneMessage);
  }

  /**
   * Append one or more messages to a session's history.
   * @param sessionId - Identifier of the session to append to.
   * @param messages - Messages to store; each is cloned on the way in.
   */
  async append(sessionId: string, messages: Message[]): Promise<void> {
    const current = this.sessions.get(sessionId) ?? [];
    current.push(...messages.map(cloneMessage));
    this.sessions.set(sessionId, current);
  }

  /**
   * Drop a session's history entirely.
   * @param sessionId - Identifier of the session to clear; a no-op if unknown.
   */
  async clear(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

/**
 * Deep clone a message so stored history can't be mutated through a returned
 * reference.
 *
 * @remarks
 * Clones nested values inside a tool call's `arguments` too. Message data is
 * plain JSON (model-emitted), so structuredClone handles it fully; this is the
 * structured-clone algorithm a serializing backend would apply for free.
 *
 * @param message - The message to clone.
 * @returns A deep copy of the message.
 * @internal
 */
function cloneMessage(message: Message): Message {
  return structuredClone(message);
}
