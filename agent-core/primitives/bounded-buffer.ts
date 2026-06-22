/**
 * A bounded FIFO buffer that sits between a producer and a consumer running at
 * different rates — the impedance matcher for backpressure, in either direction.
 *
 * Backpressure is symmetric: there is always a fast side and a slow side with a
 * buffer between them, and the only real variable is **what happens to an
 * arrival when the buffer is full**. That single decision — the
 * {@link OverflowPolicy} — is what lets one primitive serve both directions:
 *
 * - **Inbound** (a websocket producing faster than the model consumes): the
 *   producer is *not* blockable — refusing to read the socket gets you
 *   disconnected — so you shed: `"drop-oldest"` or `{ coalesce }`.
 * - **Outbound** (the loop producing replies/tool work faster than a
 *   rate-limited downstream accepts): the producer *is* blockable, so `"block"`
 *   reports "full" and lets the caller apply real backpressure upstream; or
 *   `{ coalesce }` folds reply deltas before a rate-limited `send`.
 *
 * Pure and host-agnostic, exactly like {@link MessageQueue}: no timers, no I/O,
 * no async. {@link drain} is the same pull-seam contract, so it plugs straight
 * into the loop's `drainSteering` / `drainFollowUp` hooks. "Block the producer"
 * stays expressible without owning an `await`: {@link push} *reports* that an
 * item was blocked (the caller still owns it) rather than blocking itself — the
 * caller drives the wait, keeping the kernel pure. An ergonomic
 * `await push()` wrapper, if ever wanted, is a thin battery on top.
 *
 * {@link MessageQueue} is just this with `capacity: Infinity` — unbounded, so the
 * overflow policy never engages and behavior is a plain FIFO.
 *
 * @example Inbound dispatcher queue — shed the stalest message under spam:
 * ```ts
 * const inbox = new BoundedBuffer<Message>({ capacity: 32, overflow: "drop-oldest" });
 * socket.on("message", (m) => {
 *   const { evicted } = inbox.push(normalize(m)); // always drains the socket
 *   if (evicted.length) metrics.increment("dropped");
 * });
 * ```
 *
 * @example Outbound: a single accumulating slot that coalesces reply deltas
 * (`capacity: 1` means every delta after the first folds into the buffered one):
 * ```ts
 * const out = new BoundedBuffer<string>({
 *   capacity: 1,
 *   overflow: { coalesce: (buf, delta) => [(buf[0] ?? "") + delta] },
 * });
 * // flush out.drain() to the rate-limited channel on a cadence the caller owns.
 * ```
 *
 * @module
 */

/**
 * How many queued items a {@link BoundedBuffer.drain | drain} releases:
 * `"one-at-a-time"` (the oldest single item) or `"all"` (every queued item).
 * Mirrors pi's `steeringMode` / `followUpMode`.
 *
 * @group Core
 */
export type DrainMode = "one-at-a-time" | "all";

/**
 * What happens to an item pushed into a {@link BoundedBuffer} that is already at
 * capacity. The four cases are genuinely distinct — they differ on whether the
 * arrival is kept and whether the producer is asked to slow down:
 *
 * - `"drop-oldest"` — evict the head to make room, admit the arrival. Stale
 *   context is the cheapest thing to lose; good for live ingress.
 * - `"drop-newest"` — refuse the arrival, leave the buffer untouched. The
 *   arrival is discarded.
 * - `"block"` — refuse the arrival but report it as *blocked*, not dropped: the
 *   caller still owns it and should apply backpressure upstream (stop producing
 *   / await space). This is the only policy that propagates pressure to the
 *   producer, so it is for *blockable* producers only.
 * - `{ coalesce }` — fold the arrival into the buffered items via `merge`
 *   instead of dropping. `merge` receives a snapshot of the buffered items and
 *   the incoming item and returns the new buffer contents; it must not grow the
 *   buffer past `capacity` (that is the whole point — it absorbs the arrival
 *   without growing).
 *
 * A user-visible "I'm catching up" reply is not a separate policy: any push that
 * does not fully admit its items is observable via {@link PushResult}, so the
 * caller reacts to that.
 *
 * @group Core
 */
export type OverflowPolicy<T> =
  | "drop-oldest"
  | "drop-newest"
  | "block"
  | { coalesce: (buffered: readonly T[], incoming: T) => T[] };

/**
 * The outcome of a {@link BoundedBuffer.push | push}, item-by-item, so a caller
 * can react to backpressure (notify, retry, or slow its producer). The four
 * arrays are disjoint and together account for every pushed item — except under
 * `{ coalesce }`, where a folded arrival is counted as {@link accepted}.
 *
 * @group Core
 */
export interface PushResult<T> {
  /** Items incorporated into the buffer (appended, or folded in by `coalesce`). */
  accepted: T[];
  /** Buffered items evicted to make room (only under `"drop-oldest"`). */
  evicted: T[];
  /** Pushed items refused and discarded (only under `"drop-newest"`). */
  refused: T[];
  /**
   * Pushed items not consumed because the buffer was full under `"block"`. The
   * caller still owns these and should apply backpressure upstream.
   */
  blocked: T[];
}

/**
 * Options for a {@link BoundedBuffer}.
 *
 * @group Core
 */
export interface BoundedBufferOptions<T> {
  /**
   * Maximum number of buffered items. `Infinity` means unbounded — the overflow
   * policy never engages. Must be `>= 1`.
   */
  capacity: number;
  /** What to do with an arrival when the buffer is full; see {@link OverflowPolicy}. */
  overflow: OverflowPolicy<T>;
  /** Drain policy. Default `"one-at-a-time"`. */
  mode?: DrainMode;
}

/**
 * A bounded FIFO buffer with a pluggable {@link OverflowPolicy}. See the
 * {@link module:primitives/bounded-buffer | module docs} for the backpressure
 * model.
 *
 * @group Core
 */
export class BoundedBuffer<T> {
  private readonly items: T[] = [];
  private readonly capacity: number;
  private readonly overflow: OverflowPolicy<T>;

  /** Drain policy — mutable so a caller can switch one-at-a-time/all at runtime. */
  mode: DrainMode;

  private droppedTotal = 0;
  private highWaterMark = 0;

  /**
   * @param options - Capacity, overflow policy, and drain mode; see
   * {@link BoundedBufferOptions}.
   * @throws If `capacity` is not `>= 1` (and not `Infinity`).
   */
  constructor(options: BoundedBufferOptions<T>) {
    if (!(options.capacity >= 1)) {
      throw new RangeError(
        `BoundedBuffer capacity must be >= 1 (or Infinity), got ${options.capacity}`,
      );
    }
    this.capacity = options.capacity;
    this.overflow = options.overflow;
    this.mode = options.mode ?? "one-at-a-time";
  }

  /** Number of items currently buffered. */
  get size(): number {
    return this.items.length;
  }

  /** Total items dropped (evicted + refused) over this buffer's lifetime. */
  get dropped(): number {
    return this.droppedTotal;
  }

  /** The largest {@link size} this buffer has reached — the backpressure read. */
  get highWater(): number {
    return this.highWaterMark;
  }

  /**
   * Push one or more items at the back of the buffer, applying the
   * {@link OverflowPolicy} per item when at capacity.
   *
   * @param items - The item(s) to push, in order.
   * @returns A {@link PushResult} accounting for every pushed item.
   */
  push(...items: T[]): PushResult<T> {
    const result: PushResult<T> = { accepted: [], evicted: [], refused: [], blocked: [] };
    for (const item of items) this.pushOne(item, result);
    if (this.items.length > this.highWaterMark) this.highWaterMark = this.items.length;
    return result;
  }

  /** Apply the overflow policy for a single item, accumulating into `result`. */
  private pushOne(item: T, result: PushResult<T>): void {
    if (this.items.length < this.capacity) {
      this.items.push(item);
      result.accepted.push(item);
      return;
    }
    // At capacity: the overflow policy decides.
    if (this.overflow === "drop-oldest") {
      const old = this.items.shift() as T;
      this.items.push(item);
      this.droppedTotal++;
      result.evicted.push(old);
      result.accepted.push(item);
    } else if (this.overflow === "drop-newest") {
      this.droppedTotal++;
      result.refused.push(item);
    } else if (this.overflow === "block") {
      result.blocked.push(item);
    } else {
      // coalesce: fold the arrival into the buffered items.
      const next = this.overflow.coalesce(this.items.slice(), item);
      this.items.length = 0;
      this.items.push(...next);
      result.accepted.push(item);
    }
  }

  /**
   * Remove and return buffered items per {@link mode}: the single oldest item
   * for `"one-at-a-time"`, or every buffered item for `"all"`. Returns an empty
   * array when empty — safe to pass directly as a drain hook.
   *
   * @returns The drained items in FIFO order.
   */
  drain(): T[] {
    if (this.items.length === 0) return [];
    if (this.mode === "all") return this.items.splice(0);
    return this.items.splice(0, 1);
  }

  /** Drop every buffered item. Does not reset {@link dropped} / {@link highWater}. */
  clear(): void {
    this.items.length = 0;
  }
}
