/**
 * Composition helpers — the SDK's stance is **composition over inheritance**.
 *
 * You never subclass a base agent/model/store. Instead you:
 *   1. build a seam from a plain function/object  (defineModel / defineMemory)
 *   2. optionally wrap it with a decorator        (withModelObserver / withMemoryNamespace)
 *   3. inject it into runAgent                      (RunAgentOptions)
 *
 * Nothing in this file (or the SDK) uses `extends`. Behavior is added by
 * wrapping, not by inheriting.
 */

import type { ModelClient, ModelRequest, ModelStream, StreamEvent } from "./model";
import type { Memory } from "./memory";

/** Build a ModelClient from a streaming function — no class, no inheritance. */
export function defineModel(stream: (req: ModelRequest) => ModelStream): ModelClient {
  return { stream };
}

/** Build a Memory from a plain object of functions — no class, no inheritance. */
export function defineMemory(impl: Memory): Memory {
  return impl;
}

/**
 * Decorate a ModelClient to observe every stream event as it flows through.
 * Composition instead of a `LoggingModelClient extends ...` subclass: the
 * wrapper is transparent and forwards every event unchanged.
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
 * Decorate a Memory so every session id is namespaced under `prefix`. Lets you
 * derive many isolated logical stores from one backend by wrapping it, rather
 * than subclassing a "NamespacedStore".
 */
export function withMemoryNamespace(memory: Memory, prefix: string): Memory {
  const key = (id: string) => `${prefix}:${id}`;
  return {
    load: (id) => memory.load(key(id)),
    append: (id, messages) => memory.append(key(id), messages),
    clear: (id) => memory.clear(key(id)),
  };
}
