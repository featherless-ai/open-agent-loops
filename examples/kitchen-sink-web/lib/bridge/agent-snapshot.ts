/**
 * Durable bridge — fold the AgentEvent stream into a serializable UI snapshot.
 *
 * This is the framework-agnostic reducer from the `agent-loop-react-ui` skill,
 * copied into this example exactly as the skill instructs ("copy the bridge into
 * your project"). The only change is the import path: a repo example imports the
 * core by relative path; a real consumer imports `@open-agent-loops/core`.
 *
 * It accumulates deltas with plain concatenation (a snapshot is read every
 * render, so a consume-once BoundedBuffer would be the wrong tool — see the
 * skill's bridge-architecture.md).
 */
import { AgentEventType } from "@open-agent-loops/core";
import type { AgentEvent, Message } from "@open-agent-loops/core";

export interface ToolCallView {
  toolCallId: string;
  toolName: string;
  args: unknown;
  status: "running" | "complete";
  result?: string;
  isError?: boolean;
}

export interface AssistantTurn {
  text: string;
  reasoning: string;
  toolCalls: ToolCallView[];
}

export interface AgentSnapshot {
  status: "idle" | "running" | "done";
  sessionId?: string;
  step: number;
  steps: number;
  messages: Message[];
  current: AssistantTurn;
}

export interface SnapshotReducer {
  apply(event: AgentEvent): void;
  snapshot(): AgentSnapshot;
}

function emptyTurn(): AssistantTurn {
  return { text: "", reasoning: "", toolCalls: [] };
}

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
          current = emptyTurn();
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
