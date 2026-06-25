/**
 * Layer B (durable bridge) — fold the agent-loop-core `AgentEvent` stream into a
 * serializable UI snapshot.
 *
 * Framework-agnostic: depends only on `@open-agent-loops/core`. No React, no UI
 * library, no timers. This file survives UI-library churn untouched — only the
 * thin Layer-C adapter that reads the snapshot ever changes.
 *
 * A snapshot is READ REPEATEDLY (once per render), so the reducer accumulates
 * deltas with plain string concatenation — *not* a consume-once `BoundedBuffer`.
 * Delta coalescing with `BoundedBuffer` belongs at the transport flush boundary
 * (see `sse-stream.ts`), where each frame is drained exactly once. Putting a
 * buffer here would be the wrong tool: you'd never drain it.
 */
import { AgentEventType } from "@open-agent-loops/core";
import type { AgentEvent, Message } from "@open-agent-loops/core";

/** A tool call as the UI sees it, joined across its start/end events by id. */
export interface ToolCallView {
  toolCallId: string;
  toolName: string;
  args: unknown;
  status: "running" | "complete";
  result?: string;
  isError?: boolean;
}

/** The assistant turn currently streaming — deltas land here. */
export interface AssistantTurn {
  /** Accumulated assistant text for the in-flight turn. */
  text: string;
  /** Accumulated reasoning channel for the in-flight turn. */
  reasoning: string;
  /** Tool calls seen this turn, running → complete, in arrival order. */
  toolCalls: ToolCallView[];
}

/** The full UI state derived from a run's event stream. */
export interface AgentSnapshot {
  status: "idle" | "running" | "done";
  sessionId?: string;
  /** 1-based index of the current model turn. */
  step: number;
  /** Total model turns, set when the run ends. */
  steps: number;
  /** The committed conversation log (from `message` events). */
  messages: Message[];
  /** The assistant turn currently streaming. Reset at each turn boundary. */
  current: AssistantTurn;
}

export interface SnapshotReducer {
  /** Fold one event into the running snapshot. */
  apply(event: AgentEvent): void;
  /** A defensively-copied view of the current snapshot, safe to hand to a UI. */
  snapshot(): AgentSnapshot;
}

function emptyTurn(): AssistantTurn {
  return { text: "", reasoning: "", toolCalls: [] };
}

/**
 * Create a reducer that folds `AgentEvent`s into an {@link AgentSnapshot}.
 *
 * Feed it from `runAgent({ onEvent: reducer.apply })` (server or client), or by
 * replaying a captured event array. Read {@link SnapshotReducer.snapshot} on
 * every render.
 *
 * Rendering convention: show `messages` as history; while `status === "running"`
 * show `current` as the live "typing" turn. A LocalRuntime-style adapter that
 * owns its own thread can ignore `messages` and read only `current`.
 */
export function createSnapshotReducer(): SnapshotReducer {
  let status: AgentSnapshot["status"] = "idle";
  let sessionId: string | undefined;
  let step = 0;
  let steps = 0;
  const messages: Message[] = [];
  let current = emptyTurn();

  return {
    apply(event) {
      switch (event.type) {
        case AgentEventType.AgentStart:
          status = "running";
          sessionId = event.sessionId;
          break;
        case AgentEventType.TurnStart:
          step = event.step;
          current = emptyTurn(); // a new assistant turn begins
          break;
        case AgentEventType.ReasoningDelta:
          current.reasoning += event.text;
          break;
        case AgentEventType.TextDelta:
          current.text += event.text;
          break;
        case AgentEventType.ToolStart:
          current.toolCalls.push({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            status: "running",
          });
          break;
        case AgentEventType.ToolEnd: {
          const call = current.toolCalls.find((c) => c.toolCallId === event.toolCallId);
          if (call) {
            call.status = "complete";
            call.result = event.result;
            call.isError = event.isError;
          }
          break;
        }
        case AgentEventType.Message:
        case AgentEventType.MessageInjected:
          messages.push(event.message);
          break;
        case AgentEventType.AgentEnd:
          status = "done";
          steps = event.steps;
          break;
        default:
          break;
      }
    },
    snapshot() {
      return {
        status,
        sessionId,
        step,
        steps,
        messages: messages.slice(),
        current: {
          text: current.text,
          reasoning: current.reasoning,
          toolCalls: current.toolCalls.map((c) => ({ ...c })),
        },
      };
    },
  };
}
