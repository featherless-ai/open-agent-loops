/**
 * Composition helpers — the SDK favors composition over inheritance.
 *
 * There are **no factories** here. A seam is just an object/function that
 * satisfies an interface, so you implement it inline:
 *
 *   const model: ModelClient = { stream: (req) => ... };
 *   const memory: Memory = { load, append, clear };
 *
 * What this file provides is *decorators* — functions that add behavior by
 * wrapping an existing seam and forwarding to it. That's the composition
 * alternative to subclassing a base class. Wrap as many times as you like.
 */

import type { ModelClient, StreamEvent } from "./model";
import type { Memory } from "./memory";

/**
 * Wrap a ModelClient to observe every stream event as it flows through.
 * Transparent: forwards each event unchanged. (Composition, not a
 * `LoggingModelClient extends ...` subclass.)
 */
export function withModelObserver(
  model: ModelClient,
  onEvent: (event: StreamEvent) => void,
): ModelClient {
  return {
    stream(req) {
      const inner = model.stream(req);
      return (async function* () {
        for await (const event of inner) {
          onEvent(event);
          yield event;
        }
      })();
    },
  };
}

/**
 * Wrap a Memory so every session id is namespaced under `prefix`. Derive many
 * isolated logical stores from one backend by wrapping it, instead of
 * subclassing a "NamespacedStore".
 */
export function withMemoryNamespace(memory: Memory, prefix: string): Memory {
  const key = (id: string) => `${prefix}:${id}`;
  return {
    load: (id) => memory.load(key(id)),
    append: (id, messages) => memory.append(key(id), messages),
    clear: (id) => memory.clear(key(id)),
  };
}
