import { describe, expect, test } from "bun:test";
import { Dispatcher } from "../channels/dispatcher";
import type { DispatcherRunBase, RunFn } from "../channels/dispatcher.types";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import { userMessage } from "../types";
import type { Message } from "../types";

const u = (content: string) => userMessage({ content });
const contents = (msgs: Message[]) => msgs.map((m) => m.content);

// A macrotask flush: lets every pending pump microtask (acquire → drain → run)
// settle before assertions. The harness runs hang until released, so call counts
// are stable once flushed.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// `base` only needs to typecheck — the injected `run` ignores model/memory.
const base = (): DispatcherRunBase => ({
  model: new MockModelClient([]),
  memory: new SessionMemoryStore(),
});

/**
 * A controllable {@link RunFn}: records each call, tracks concurrency, hangs
 * until `releaseNext()` (or `releaseAll()`), and rejects a run if its signal
 * aborts (so supersede is observable).
 */
function runHarness() {
  const calls: { sessionId: string; prompt: Message[]; signal?: AbortSignal }[] = [];
  const gates: Array<() => void> = [];
  let active = 0;
  let maxActive = 0;

  const run: RunFn = async (opts) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    calls.push({
      sessionId: opts.sessionId,
      prompt: opts.prompt as Message[],
      signal: opts.signal,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        gates.push(resolve);
        opts.signal?.addEventListener("abort", () =>
          reject(opts.signal?.reason ?? new Error("aborted")),
        );
      });
      return { messages: [], newMessages: [], steps: 1 };
    } finally {
      active -= 1;
    }
  };

  return {
    run,
    calls,
    releaseNext: () => gates.shift()?.(),
    releaseAll: () => {
      while (gates.length) gates.shift()?.();
    },
    get maxActive() {
      return maxActive;
    },
  };
}

describe("Dispatcher", () => {
  // Coalesce: a synchronous burst to one session folds into a SINGLE run whose
  // prompt is the whole backlog, in order.
  test("coalesces a burst into one run with the whole backlog", async () => {
    const h = runHarness();
    const d = new Dispatcher({ base: base(), run: h.run });

    for (const c of ["a", "b", "c"]) d.submit("s", u(c));
    await tick();

    expect(h.calls.length).toBe(1);
    expect(contents(h.calls[0]!.prompt)).toEqual(["a", "b", "c"]);
  });

  // Serialize: a message arriving while a session's run is in flight does not
  // start a second run until the first finishes.
  test("serializes runs within a session (one in flight at a time)", async () => {
    const h = runHarness();
    const d = new Dispatcher({ base: base(), run: h.run });

    d.submit("s", u("a"));
    await tick();
    d.submit("s", u("b")); // arrives mid-run
    await tick();
    expect(h.calls.length).toBe(1); // "b" is queued, not running

    h.releaseNext(); // finish run #1
    await tick();
    expect(h.calls.length).toBe(2);
    expect(contents(h.calls[1]!.prompt)).toEqual(["b"]);
  });

  // Global cap: two different sessions cannot exceed maxConcurrency runs at once.
  test("caps global in-flight runs across sessions at maxConcurrency", async () => {
    const h = runHarness();
    const d = new Dispatcher({ base: base(), run: h.run, maxConcurrency: 1 });

    d.submit("s1", u("a"));
    d.submit("s2", u("b"));
    await tick();

    expect(h.calls.length).toBe(1); // s2 waits on the semaphore
    expect(d.inFlight).toBe(1);

    h.releaseNext();
    await tick();
    expect(h.calls.length).toBe(2);
    expect(h.maxActive).toBe(1); // never two at once
  });

  // Supersede: a newer message aborts the in-flight run; the next run carries the
  // newer message, and the stale run's signal is aborted.
  test("supersede aborts the in-flight run and runs the newer message", async () => {
    const h = runHarness();
    const d = new Dispatcher({ base: base(), run: h.run, supersede: true });

    d.submit("s", u("a"));
    await tick();
    expect(h.calls.length).toBe(1);

    d.submit("s", u("b")); // supersede
    await tick();

    expect(h.calls[0]!.signal?.aborted).toBe(true);
    expect(h.calls.length).toBe(2);
    expect(contents(h.calls[1]!.prompt)).toEqual(["b"]);
  });

  // Without supersede, a mid-run message waits and runs after — the in-flight run
  // is NOT aborted.
  test("without supersede the in-flight run finishes before the next", async () => {
    const h = runHarness();
    const d = new Dispatcher({ base: base(), run: h.run }); // supersede off

    d.submit("s", u("a"));
    await tick();
    d.submit("s", u("b"));
    await tick();

    expect(h.calls[0]!.signal?.aborted).toBe(false);
    expect(h.calls.length).toBe(1); // still serialized behind run #1
  });

  // Overflow wiring: while a run hangs, an over-capacity flood sheds per the
  // per-session policy (drop-oldest), so the next coalesced prompt reflects it.
  test("applies the per-session overflow policy to an over-capacity flood", async () => {
    const h = runHarness();
    const d = new Dispatcher({
      base: base(),
      run: h.run,
      capacity: 2,
      overflow: "drop-oldest",
    });

    d.submit("s", u("a")); // drained into run #1, which hangs
    await tick();
    expect(h.calls.length).toBe(1);

    // Flood while #1 is in flight: buffer cap 2, drop-oldest evicts "b".
    d.submit("s", u("b"), u("c"), u("d"));
    await tick();

    h.releaseNext(); // finish #1 → run #2 drains the (capped) backlog
    await tick();
    expect(h.calls.length).toBe(2);
    expect(contents(h.calls[1]!.prompt)).toEqual(["c", "d"]); // "b" was dropped
  });

  // Resilience: a non-abort run rejection surfaces via onError and does not wedge
  // the session — the next message still runs.
  test("a failed run surfaces via onError without wedging the session", async () => {
    const errors: string[] = [];
    const failing: RunFn = async (opts) => {
      if ((opts.prompt as Message[])[0]!.content === "boom") throw new Error("kaboom");
      return { messages: [], newMessages: [], steps: 1 };
    };
    const d = new Dispatcher({
      base: base(),
      run: failing,
      onError: (e) => errors.push((e as Error).message),
    });

    d.submit("s", u("boom"));
    await tick();
    d.submit("s", u("ok"));
    await tick();

    expect(errors).toEqual(["kaboom"]);
  });
});
