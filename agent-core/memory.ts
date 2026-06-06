/**
 * The plug-and-play memory seam. The loop reads context and appends turns
 * through this interface only — it has no idea whether messages live in RAM,
 * on disk, in Redis, or behind a vector index. Swap the implementation, keep
 * the loop untouched.
 *
 * v1 ships a single in-memory store; durable backends (JSONL, Redis, vector)
 * are future implementations of the same interface.
 */

import type { Message } from "./types";

export interface Memory {
  /** Return the full message history for a session (oldest first). */
  load(sessionId: string): Promise<Message[]>;
  /** Append one or more messages to a session's history. */
  append(sessionId: string, messages: Message[]): Promise<void>;
  /** Drop a session's history entirely. */
  clear(sessionId: string): Promise<void>;
}

/**
 * Simplest possible backend: a Map of sessionId -> messages.
 *
 * Defensive copying is deliberate. `load` returns a fresh array of cloned
 * messages and `append` clones on the way in, so callers can never mutate
 * stored history by holding a reference — the same guarantee a real
 * (serializing) backend would give for free.
 */
export class InMemoryStore implements Memory {
  private readonly sessions = new Map<string, Message[]>();

  async load(sessionId: string): Promise<Message[]> {
    const stored = this.sessions.get(sessionId) ?? [];
    return stored.map(cloneMessage);
  }

  async append(sessionId: string, messages: Message[]): Promise<void> {
    const current = this.sessions.get(sessionId) ?? [];
    current.push(...messages.map(cloneMessage));
    this.sessions.set(sessionId, current);
  }

  async clear(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

/** Shallow-deep clone good enough for plain message objects. */
function cloneMessage(message: Message): Message {
  return {
    ...message,
    toolCalls: message.toolCalls?.map((call) => ({
      ...call,
      arguments: { ...call.arguments },
    })),
  };
}
