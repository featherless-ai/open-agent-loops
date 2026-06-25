/**
 * AsyncWriter — a fire-and-forget, queued, batched JSON-line writer for traces.
 *
 * The agent loop calls `enqueue(line)` synchronously and (almost always) returns
 * immediately: the line is pushed onto an in-memory queue and a background drain
 * is scheduled on the next microtask. Writes are **batched** (up to `batchSize`
 * per call) and **ordered** (one `write()` in flight at a time), so a slow or
 * async sink — a file, a socket — never runs on the hot path.
 *
 * Backpressure is **block-until-drained**: only when the queue reaches
 * `maxQueue` does `enqueue` return a promise (resolving once the queue drains),
 * so a caller that awaits it — the tracer's `sink`, which the loop awaits — is
 * throttled instead of letting the queue grow without bound.
 *
 * Writer errors are isolated: a throwing/rejecting `write()` is caught and
 * counted (`errors`), never surfaced into the run it observes. Zero deps.
 */

export interface AsyncWriterOptions {
  /** Max lines handed to `write()` per call. Default 100. */
  batchSize?: number;
  /** Queue high-water mark; `enqueue` applies backpressure at or above it. Default 1000. */
  maxQueue?: number;
}

export class AsyncWriter {
  private readonly queue: string[] = [];
  private readonly waiters: Array<() => void> = [];
  private flushing: Promise<void> | undefined;
  private scheduled = false;
  private readonly batchSize: number;
  private readonly maxQueue: number;

  /** Count of `write()` calls that threw/rejected (isolated, not surfaced). */
  errors = 0;

  constructor(
    private readonly write: (lines: string[]) => void | Promise<void>,
    options: AsyncWriterOptions = {},
  ) {
    this.batchSize = Math.max(1, options.batchSize ?? 100);
    this.maxQueue = Math.max(1, options.maxQueue ?? 1000);
  }

  /** Lines waiting to be written. */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Queue a line. Returns nothing on the fast path; returns a promise (resolving
   * when the queue drains) only when the queue is at/over `maxQueue`, so an
   * awaiting producer is throttled.
   */
  enqueue(line: string): void | Promise<void> {
    this.queue.push(line);
    this.schedule();
    if (this.queue.length >= this.maxQueue) {
      return new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  /** Drain everything and await the sink — call at run end so the tail isn't lost. */
  async flush(): Promise<void> {
    do {
      await this.drain();
    } while (this.queue.length > 0);
  }

  private schedule(): void {
    if (this.scheduled || this.flushing) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.drain();
    });
  }

  private drain(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.run().finally(() => this.settle());
    return this.flushing;
  }

  /** Write queued lines in order, batchSize at a time, until the queue is empty. */
  private async run(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.batchSize);
      try {
        await this.write(batch);
      } catch {
        this.errors += 1; // isolate sink failures from the observed run
      }
    }
  }

  /** After a drain cycle: reschedule if more arrived, else release backpressure waiters. */
  private settle(): void {
    this.flushing = undefined;
    if (this.queue.length > 0) {
      this.schedule();
      return;
    }
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}
