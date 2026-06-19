import { describe, expect, test } from "bun:test";
import { AsyncWriter } from "../observability/async-writer";

/** A write sink that records the batches it received; optionally slow/throwing. */
function sink(opts: { delayMs?: number; throwOn?: number } = {}) {
  const batches: string[][] = [];
  let calls = 0;
  const write = async (lines: string[]) => {
    calls += 1;
    if (opts.throwOn === calls) throw new Error("sink boom");
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    batches.push(lines);
  };
  return { write, batches, get calls() { return calls; } };
}

// AsyncWriter is effectful (timing, concurrency, failure isolation), so each
// property below is genuinely distinct — none is a plain input→output mapping.
describe("AsyncWriter", () => {
  // Deferred + ordered: nothing writes inline; flush drains in arrival order.
  test("defers writes and drains them in order", async () => {
    const s = sink();
    const w = new AsyncWriter(s.write);
    w.enqueue("a");
    w.enqueue("b");
    expect(s.calls).toBe(0); // nothing written synchronously
    await w.flush();
    expect(s.batches.flat()).toEqual(["a", "b"]);
  });

  // Batching: lines are handed to write() in chunks of at most batchSize.
  test("batches at batchSize", async () => {
    const s = sink();
    const w = new AsyncWriter(s.write, { batchSize: 2 });
    for (const l of ["a", "b", "c", "d", "e"]) w.enqueue(l);
    await w.flush();
    expect(s.batches).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  // Ordering holds even when the sink is slow (one write in flight at a time).
  test("stays ordered under a slow sink", async () => {
    const s = sink({ delayMs: 5 });
    const w = new AsyncWriter(s.write, { batchSize: 1 });
    for (const l of ["1", "2", "3"]) w.enqueue(l);
    await w.flush();
    expect(s.batches.flat()).toEqual(["1", "2", "3"]);
  });

  // Failure isolation: a throwing sink is caught + counted, never surfaced.
  test("isolates and counts sink errors", async () => {
    const s = sink({ throwOn: 1 });
    const w = new AsyncWriter(s.write, { batchSize: 1 });
    w.enqueue("a");
    w.enqueue("b");
    await w.flush(); // must not reject
    expect(w.errors).toBe(1);
    expect(s.batches.flat()).toEqual(["b"]); // the next write still happened
  });

  // Backpressure: at the high-water mark enqueue returns a promise that drains.
  test("applies backpressure at the high-water mark", async () => {
    const s = sink({ delayMs: 2 });
    const w = new AsyncWriter(s.write, { maxQueue: 2, batchSize: 10 });
    expect(w.enqueue("a")).toBeUndefined(); // below cap → no backpressure
    const back = w.enqueue("b"); // hits cap → promise
    expect(back).toBeInstanceOf(Promise);
    await back;
    expect(w.pending).toBe(0);
  });
});
