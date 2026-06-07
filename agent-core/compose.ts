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
 *
 * @module
 */

import type { ModelClient, StreamEvent } from "./model.types";
import type { Memory, MemoryListener } from "./memory/memory.types";

/**
 * Wrap a {@link ModelClient} to observe every stream event as it flows through.
 *
 * @remarks
 * Transparent: forwards each event unchanged. (Composition, not a
 * `LoggingModelClient extends ...` subclass.)
 *
 * @param model - The model client to wrap.
 * @param onEvent - Called with each {@link StreamEvent} before it is forwarded.
 * @returns A {@link ModelClient} that tees every event to `onEvent`.
 * @example
 * ```ts
 * const observed = withModelObserver(model, (event) => {
 *   if (event.type === StreamEventType.TextDelta) process.stdout.write(event.text);
 * });
 * ```
 * @see {@link withMemoryListeners}
 * @group Composition
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
 * Wrap a {@link Memory} so every session id is namespaced under `prefix`.
 *
 * @remarks
 * Derive many isolated logical stores from one backend by wrapping it, instead
 * of subclassing a "NamespacedStore".
 *
 * @param memory - The memory backend to wrap.
 * @param prefix - Namespace prepended to each session id as `prefix:id`.
 * @returns A {@link Memory} whose session ids are namespaced.
 * @example
 * ```ts
 * const tenantMemory = withMemoryNamespace(store, "tenant-42");
 * await tenantMemory.load("chat"); // reads under "tenant-42:chat"
 * ```
 * @group Composition
 */
export function withMemoryNamespace(memory: Memory, prefix: string): Memory {
  const key = (id: string) => `${prefix}:${id}`;
  return {
    load: (id) => memory.load(key(id)),
    append: (id, messages) => memory.append(key(id), messages),
    clear: (id) => memory.clear(key(id)),
  };
}

/**
 * Wrap a {@link Memory} so a {@link MemoryListener} is notified after each operation.
 *
 * @remarks
 * This is the observer/listener seam for storage — the counterpart to
 * {@link withModelObserver} for the model. Listeners only *react* (logging,
 * metrics, cache warming); each callback runs after the underlying op succeeds
 * and its return value is ignored, so the result the loop sees is never altered.
 *
 * Attach more than one listener by wrapping more than once — wrappers stack.
 *
 * @param memory - The memory backend to wrap.
 * @param listener - Callbacks invoked after each successful operation.
 * @returns A {@link Memory} that notifies `listener` after each op.
 * @example
 * ```ts
 * const logged = withMemoryListeners(store, {
 *   onAppend: (id, messages) => console.log(`+${messages.length} to ${id}`),
 * });
 * ```
 * @see {@link withModelObserver}
 * @group Composition
 */
export function withMemoryListeners(memory: Memory, listener: MemoryListener): Memory {
  return {
    async load(id) {
      const messages = await memory.load(id);
      await listener.onLoad?.(id, messages);
      return messages;
    },
    async append(id, messages) {
      await memory.append(id, messages);
      await listener.onAppend?.(id, messages);
    },
    async clear(id) {
      await memory.clear(id);
      await listener.onClear?.(id);
    },
  };
}
