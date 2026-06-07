/**
 * `InMemoryStore` — the v1 implementation of the `Memory` seam (interface in
 * `./memory.types`). Simplest possible backend: a Map of sessionId -> messages.
 *
 * Defensive copying is deliberate. `load` returns a fresh array of cloned
 * messages and `append` clones on the way in, so callers can never mutate
 * stored history by holding a reference — the same guarantee a real
 * (serializing) backend would give for free.
 */

import type { Message } from "../types";
import type { Memory } from "./memory.types";

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

/**
 * Deep clone a message so stored history can't be mutated through a returned
 * reference — including nested values inside a tool call's `arguments`. Message
 * data is plain JSON (model-emitted), so structuredClone handles it fully; this
 * is the structured-clone algorithm a serializing backend would apply for free.
 */
function cloneMessage(message: Message): Message {
  return structuredClone(message);
}
