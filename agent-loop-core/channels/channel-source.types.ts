/**
 * The {@link ChannelSource} transport seam — the boundary between a live channel
 * (Slack, Discord, …) and the agent. It is to the *transport* what `ModelClient`
 * is to the model: a plain interface you implement once per provider, satisfied
 * by a plain object.
 *
 * It owns **liveness only** — connect/disconnect, heartbeat, reconnect with
 * backoff, resume cursors — and the normalization of provider-specific events
 * into a single {@link InboundMessage}. It deliberately knows nothing about the
 * model, throttling, or memory; the {@link ChannelBridge} wires it to the
 * {@link Dispatcher}, which owns those. Keeping the two apart is the whole point:
 * "keep the socket alive" and "don't overwhelm the model" never block each other.
 *
 * @module
 */

/**
 * A normalized inbound message — the single shape every transport maps its
 * provider events into, so the rest of the system is channel-agnostic.
 *
 * @group Channels
 */
export interface InboundMessage {
  /** The channel the message arrived on (Slack channel id, Discord channel id, …). */
  channelId: string;
  /**
   * The thread within the channel, if the provider threads replies. A thread is
   * the natural unit of conversation, so it maps to a `sessionId` by default.
   */
  threadId?: string;
  /** Who sent the message. */
  userId: string;
  /** The message text. */
  text: string;
}

/**
 * Where a reply is posted back — the channel/thread a run's output returns to.
 *
 * @group Channels
 */
export interface OutboundTarget {
  /** The channel to post into. */
  channelId: string;
  /** The thread to post into, if any. */
  threadId?: string;
}

/**
 * A live channel transport. Implementations: `SlackSource`, `DiscordSource`, …;
 * {@link InMemoryChannelSource} is the test/example fake.
 *
 * @group Channels
 */
export interface ChannelSource {
  /**
   * Begin receiving. `onMessage` is invoked for every normalized inbound message
   * — the source must **drain and ack its transport continuously** and never stop
   * reading just because a run is in flight (that is what the bounded queue
   * downstream is for). Owns its own reconnect/heartbeat internally.
   *
   * @param onMessage - Called per normalized inbound message.
   */
  start(onMessage: (message: InboundMessage) => void): void | Promise<void>;

  /**
   * Post reply text back to a channel/thread.
   *
   * @param target - Where the reply goes.
   * @param text - The reply text.
   */
  send(target: OutboundTarget, text: string): void | Promise<void>;

  /** Stop receiving and release the transport. */
  stop(): void | Promise<void>;
}
