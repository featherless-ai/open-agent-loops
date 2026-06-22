import { describe, expect, test } from "bun:test";
import { BoundedBuffer } from "../primitives/bounded-buffer";

describe("BoundedBuffer", () => {
  // Base: below capacity it is a plain FIFO — everything is accepted, in order.
  test("base: admits items in FIFO order while below capacity", () => {
    const b = new BoundedBuffer<string>({ capacity: 3, overflow: "block" });
    const r = b.push("a", "b");

    expect(r.accepted).toEqual(["a", "b"]);
    expect(r.evicted).toEqual([]);
    expect(b.size).toBe(2);
    expect(b.drain()).toEqual(["a"]);
    expect(b.drain()).toEqual(["b"]);
  });

  // drop-oldest: at capacity, evict the head to admit the arrival.
  test("drop-oldest evicts the head and admits the arrival", () => {
    const b = new BoundedBuffer<string>({ capacity: 2, overflow: "drop-oldest" });
    b.push("a", "b");
    const r = b.push("c");

    expect(r.evicted).toEqual(["a"]);
    expect(r.accepted).toEqual(["c"]);
    expect(b.dropped).toBe(1);
    b.mode = "all";
    expect(b.drain()).toEqual(["b", "c"]); // "a" is gone
  });

  // drop-newest: at capacity, refuse the arrival and keep the buffer intact.
  test("drop-newest refuses the arrival and leaves the buffer untouched", () => {
    const b = new BoundedBuffer<string>({ capacity: 2, overflow: "drop-newest" });
    b.push("a", "b");
    const r = b.push("c");

    expect(r.refused).toEqual(["c"]);
    expect(r.accepted).toEqual([]);
    expect(b.dropped).toBe(1);
    b.mode = "all";
    expect(b.drain()).toEqual(["a", "b"]); // "c" never entered
  });

  // block: at capacity, report the arrival as blocked (not dropped) — the caller
  // still owns it and applies backpressure upstream. Nothing is lost.
  test("block reports the arrival as blocked without dropping it", () => {
    const b = new BoundedBuffer<string>({ capacity: 1, overflow: "block" });
    b.push("a");
    const r = b.push("b");

    expect(r.blocked).toEqual(["b"]);
    expect(r.accepted).toEqual([]);
    expect(b.dropped).toBe(0); // blocked is not dropped
    expect(b.size).toBe(1);
  });

  // coalesce: at capacity, fold the arrival into the buffered items via merge
  // instead of dropping. capacity:1 turns the buffer into one accumulating slot.
  test("coalesce folds the arrival into the buffer instead of dropping", () => {
    const b = new BoundedBuffer<string>({
      capacity: 1,
      overflow: { coalesce: (buf, incoming) => [(buf[0] ?? "") + incoming] },
    });
    b.push("a"); // fills the single slot
    const r = b.push("b"); // folds into the slot
    b.push("c");

    expect(r.accepted).toEqual(["b"]);
    expect(b.dropped).toBe(0);
    expect(b.size).toBe(1);
    expect(b.drain()).toEqual(["abc"]);
  });

  // Metric: highWater records the peak depth even after items drain away.
  test("highWater records peak depth across the buffer's lifetime", () => {
    const b = new BoundedBuffer<string>({ capacity: 5, overflow: "block" });
    b.push("a", "b", "c");
    b.mode = "all";
    b.drain();

    expect(b.size).toBe(0);
    expect(b.highWater).toBe(3);
  });

  // Edge: capacity must be >= 1 — fail fast on a nonsense bound.
  test("edge: rejects a capacity below 1", () => {
    expect(() => new BoundedBuffer({ capacity: 0, overflow: "block" })).toThrow(RangeError);
  });

  // Edge: Infinity capacity is unbounded — the overflow policy never engages.
  test("edge: Infinity capacity never overflows", () => {
    const b = new BoundedBuffer<number>({ capacity: Infinity, overflow: "drop-newest" });
    const r = b.push(1, 2, 3, 4);

    expect(r.accepted).toEqual([1, 2, 3, 4]);
    expect(r.refused).toEqual([]);
    expect(b.size).toBe(4);
  });
});
