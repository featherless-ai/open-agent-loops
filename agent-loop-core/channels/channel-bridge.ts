/**
 * Wires a {@link ChannelSource} (transport) to a {@link Dispatcher} (throttling),
 * so a live channel drives `runAgent` with backpressure and the agent's replies
 * stream back out — and `runAgent` itself never changes.
 *
 * Two directions, both flowing through the bridge:
 *
 * - **Inbound**: each {@link InboundMessage} is mapped to a `sessionId` (one per
 *   thread by default, so a thread becomes a `runAgent` conversation and `Memory`
 *   Just Works) and `submit`ted to the dispatcher. The bridge returns instantly,
 *   so the source keeps draining its socket; backpressure lives in the
 *   dispatcher's per-session {@link BoundedBuffer}.
 * - **Outbound**: the dispatcher tags each run's events with their `sessionId`
 *   (via `onSessionEvent`), so the bridge routes them to the right channel/thread.
 *   `TextDelta`s are coalesced through a per-session {@link BoundedBuffer} and
 *   flushed as one reply per assistant turn — collapsing a token stream into a
 *   single `send`, which is what a rate-limited channel API needs.
 *
 * The bridge owns its dispatcher (constructed from the config you pass), which is
 * what lets it wire `onSessionEvent` to its own router cleanly.
 *
 * @module
 */

import { Dispatcher } from "./dispatcher";
import type { DispatcherRunBase } from "./dispatcher.types";
import { BoundedBuffer } from "../primitives/bounded-buffer";
import type { OverflowPolicy } from "../primitives/bounded-buffer";
import type { ChannelSource, InboundMessage, OutboundTarget } from "./channel-source.types";
import { AgentEventType, contentToText, isAssistantMessage, userMessage } from "../types";
import type { AgentEvent, Message } from "../types";

/**
 * The default `thread → sessionId` mapping: one conversation per thread (falling
 * back to the channel when a provider doesn't thread). Override via
 * {@link ChannelBridgeOptions.sessionIdFor} for per-channel or per-user grain.
 */
export function defaultSessionId(message: InboundMessage): string {
  return `${message.channelId}:${message.threadId ?? ""}`;
}

/**
 * Options for a {@link ChannelBridge}. The throttling knobs are forwarded to the
 * dispatcher the bridge creates.
 *
 * @group Channels
 */
export interface ChannelBridgeOptions {
  /** The transport to connect. */
  source: ChannelSource;
  /** Shared run config (model, memory, tools, system, …) for every session. */
  base: DispatcherRunBase;
  /** Map an inbound message to a `sessionId`. Default {@link defaultSessionId}. */
  sessionIdFor?: (message: InboundMessage) => string;
  /** Per-session inbound buffer capacity. See {@link DispatcherOptions.capacity}. */
  capacity?: number;
  /** Inbound overflow policy. See {@link DispatcherOptions.overflow}. */
  overflow?: OverflowPolicy<Message>;
  /** Max runs in flight across all sessions. See {@link DispatcherOptions.maxConcurrency}. */
  maxConcurrency?: number;
  /** Abort the in-flight run when a newer message arrives. See {@link DispatcherOptions.supersede}. */
  supersede?: boolean;
  /** Observe a run that failed (non-abort). See {@link DispatcherOptions.onError}. */
  onError?: (error: unknown, sessionId: string) => void;
}

/** Per-session outbound state: the delta-coalescing buffer and the reply target. */
interface OutboundState {
  buffer: BoundedBuffer<string>;
  target: OutboundTarget;
  sawDelta: boolean;
}

/**
 * Connects a {@link ChannelSource} to a {@link Dispatcher}. Construct it, then
 * {@link start}; {@link stop} to tear down.
 *
 * @group Channels
 */
export class ChannelBridge {
  /** The dispatcher this bridge drives — exposed for `stats()` / observability. */
  readonly dispatcher: Dispatcher;

  private readonly source: ChannelSource;
  private readonly sessionIdFor: (message: InboundMessage) => string;
  private readonly outbound = new Map<string, OutboundState>();

  constructor(options: ChannelBridgeOptions) {
    this.source = options.source;
    this.sessionIdFor = options.sessionIdFor ?? defaultSessionId;
    this.dispatcher = new Dispatcher({
      base: options.base,
      capacity: options.capacity,
      overflow: options.overflow,
      maxConcurrency: options.maxConcurrency,
      supersede: options.supersede,
      onError: options.onError,
      onSessionEvent: (sessionId, event) => this.route(sessionId, event),
    });
  }

  /** Start receiving from the source. */
  async start(): Promise<void> {
    await this.source.start((message) => this.handleInbound(message));
  }

  /** Stop receiving from the source. */
  async stop(): Promise<void> {
    await this.source.stop();
  }

  /**
   * Send whatever reply text has accumulated for a session right now. Called
   * automatically at each assistant-turn boundary; also exposed so a caller can
   * drive a streaming cadence (e.g. flush every second) if it owns a timer.
   *
   * @param sessionId - The session to flush.
   */
  flush(sessionId: string): void {
    const state = this.outbound.get(sessionId);
    if (!state) return;
    const [text] = state.buffer.drain();
    if (text) void this.source.send(state.target, text);
  }

  /** Inbound: map to a session, remember where replies go, submit to the dispatcher. */
  private handleInbound(message: InboundMessage): void {
    const sessionId = this.sessionIdFor(message);
    const target: OutboundTarget = { channelId: message.channelId, threadId: message.threadId };
    this.outboundFor(sessionId, target).target = target;
    this.dispatcher.submit(sessionId, userMessage({ content: message.text }));
  }

  /** Outbound: accumulate the run's text, flush one reply per assistant turn. */
  private route(sessionId: string, event: AgentEvent): void {
    const state = this.outbound.get(sessionId);
    if (!state) return; // a session we never mapped a target for
    switch (event.type) {
      case AgentEventType.TextDelta:
        state.buffer.push(event.text); // coalesced into the single slot
        state.sawDelta = true;
        break;
      case AgentEventType.Message:
        if (isAssistantMessage(event.message)) {
          this.flushReply(sessionId, state, contentToText(event.message.content));
        }
        break;
      case AgentEventType.AgentEnd:
        this.flushReply(sessionId, state); // safety net; usually already drained
        break;
      default:
        break;
    }
  }

  /**
   * Send the accumulated reply for a turn: the coalesced deltas if any, else the
   * complete assistant content (for a non-streaming model). Never sends empty
   * (e.g. a tool-only turn).
   */
  private flushReply(sessionId: string, state: OutboundState, fallback?: string): void {
    const [streamed] = state.buffer.drain();
    const text = streamed ?? (state.sawDelta ? "" : (fallback ?? ""));
    state.sawDelta = false;
    if (text) void this.source.send(state.target, text);
  }

  private outboundFor(sessionId: string, target: OutboundTarget): OutboundState {
    let state = this.outbound.get(sessionId);
    if (!state) {
      state = {
        // capacity 1 + coalesce = one accumulating slot: every delta folds into
        // the buffered string, so a token stream becomes a single reply.
        buffer: new BoundedBuffer<string>({
          capacity: 1,
          overflow: { coalesce: (buffered, incoming) => [(buffered[0] ?? "") + incoming] },
        }),
        target,
        sawDelta: false,
      };
      this.outbound.set(sessionId, state);
    }
    return state;
  }
}
