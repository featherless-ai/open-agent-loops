/**
 * An in-memory {@link ChannelSource} fake — the test/example double that lets you
 * drive the whole channel path (source → bridge → dispatcher → runAgent → reply)
 * without a real socket. You push inbound traffic with {@link emit} and read the
 * replies it would have posted from {@link sent}.
 *
 * @module
 */

import type { ChannelSource, InboundMessage, OutboundTarget } from "./channel-source.types";

/** One reply the source was asked to post — recorded for inspection. */
export interface SentReply {
  /** Where it was posted. */
  target: OutboundTarget;
  /** The reply text. */
  text: string;
}

/**
 * A {@link ChannelSource} backed by in-memory arrays. No I/O, no timers — perfect
 * for tests and the runnable example.
 *
 * @group Channels
 */
export class InMemoryChannelSource implements ChannelSource {
  /** Every reply posted via {@link send}, in order. */
  readonly sent: SentReply[] = [];

  private onMessage?: (message: InboundMessage) => void;

  start(onMessage: (message: InboundMessage) => void): void {
    this.onMessage = onMessage;
  }

  send(target: OutboundTarget, text: string): void {
    this.sent.push({ target, text });
  }

  stop(): void {
    this.onMessage = undefined;
  }

  /**
   * Simulate an inbound message arriving on the socket. Use this from a test or
   * example to drive traffic — including bursts, by calling it several times in a
   * row synchronously.
   *
   * @param message - The inbound message to deliver.
   * @throws If called before {@link start}.
   */
  emit(message: InboundMessage): void {
    if (!this.onMessage) {
      throw new Error("InMemoryChannelSource: emit() called before start()");
    }
    this.onMessage(message);
  }
}
