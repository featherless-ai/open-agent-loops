/**
 * Events emitted by the loop for observability / streaming to a UI, and the sink
 * that consumes them.
 *
 * @module
 */

import type { ToolSpec } from "../model.types";
import type { Message } from "./message";
import type { ToolArguments } from "./tool-calls";

/**
 * Discriminant tags for {@link AgentEvent}.
 *
 * @remarks
 * A string enum: each member's value is the wire string it replaces, so
 * serialized events (JSON to a UI, logs) are byte-for-byte unchanged — only the
 * in-code references become named constants.
 *
 * @group Messages & Events
 */
export enum AgentEventType {
  /** The run has started. */
  AgentStart = "agent_start",
  /** A new model turn has started. */
  TurnStart = "turn_start",
  /** A partial chunk of the assistant's reasoning channel. */
  ReasoningDelta = "reasoning_delta",
  /** A partial chunk of the assistant's text content. */
  TextDelta = "text_delta",
  /** A complete message was added to the conversation. */
  Message = "message",
  /** A tool call is about to execute. */
  ToolStart = "tool_start",
  /** A tool call finished, carrying its result. */
  ToolEnd = "tool_end",
  /** The run has ended. */
  AgentEnd = "agent_end",
}

/**
 * The payload of an event, minus the timestamp.
 *
 * @remarks
 * The loop's call sites construct these; `emit` stamps each one centrally on the
 * way out (see {@link AgentEvent}), so no call site has to remember to set the
 * time.
 *
 * @group Messages & Events
 */
export type AgentEventBody =
  | {
      /** Discriminant; see {@link AgentEventType.AgentStart}. */
      type: AgentEventType.AgentStart;
      /** The session whose run is starting. */
      sessionId: string;
      /**
       * [observability] The run's system prompt, if any. Carried on this event
       * so an observer (a tracer, a UI) sees it without having to tap the model
       * request — the loop already knows it at start.
       */
      system?: string;
      /**
       * [observability] The full tool specs available to the model this run —
       * same rationale as {@link system}: surfaced once up front so observers
       * needn't reconstruct the tool surface from later events.
       */
      tools?: ToolSpec[];
    }
  | {
      /** Discriminant; see {@link AgentEventType.TurnStart}. */
      type: AgentEventType.TurnStart;
      /** 1-based index of the model turn that is starting. */
      step: number;
    }
  | {
      /** Discriminant; see {@link AgentEventType.ReasoningDelta}. */
      type: AgentEventType.ReasoningDelta;
      /** A chunk of the assistant's reasoning channel. */
      text: string;
    }
  | {
      /** Discriminant; see {@link AgentEventType.TextDelta}. */
      type: AgentEventType.TextDelta;
      /** A chunk of the assistant's text content. */
      text: string;
    }
  | {
      /** Discriminant; see {@link AgentEventType.Message}. */
      type: AgentEventType.Message;
      /** The complete message that was appended to the conversation. */
      message: Message;
    }
  | {
      /** Discriminant; see {@link AgentEventType.ToolStart}. */
      type: AgentEventType.ToolStart;
      /** Id of the tool call about to run, matching its {@link AgentEventType.ToolEnd} event. */
      toolCallId: string;
      /** Name of the tool about to run. */
      toolName: string;
      /** The parsed arguments the tool will receive. */
      args: ToolArguments;
    }
  | {
      /** Discriminant; see {@link AgentEventType.ToolEnd}. */
      type: AgentEventType.ToolEnd;
      /** Id of the finished tool call, matching its {@link AgentEventType.ToolStart} event. */
      toolCallId: string;
      /** Name of the tool that ran. */
      toolName: string;
      /** The tool result text folded back into the conversation. */
      result: string;
      /** Whether the tool reported an error. */
      isError: boolean;
    }
  | {
      /** Discriminant; see {@link AgentEventType.AgentEnd}. */
      type: AgentEventType.AgentEnd;
      /** The full conversation as of run end. */
      messages: Message[];
      /** Total number of model turns the run took. */
      steps: number;
    };

/**
 * An event emitted by the loop for observability / streaming to a UI.
 *
 * @remarks
 * Every event carries a `timestamp` (ms since epoch) stamped at emit time, so a
 * consumer can measure latency between turns, tokens, and tool calls. The
 * intersection still discriminates on `type` exactly like the body union does.
 *
 * @see {@link AgentEventBody}
 * @see {@link EventSink}
 * @group Messages & Events
 */
export type AgentEvent = AgentEventBody & {
  /** Emit time in ms since the epoch, stamped centrally as the event goes out. */
  timestamp: number;
};

/**
 * Consumer callback for {@link AgentEvent}s emitted during a run.
 *
 * @group Messages & Events
 */
export type EventSink = (event: AgentEvent) => void | Promise<void>;
