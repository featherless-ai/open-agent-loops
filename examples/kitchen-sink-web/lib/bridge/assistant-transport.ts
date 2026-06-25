/**
 * Layer-B transport for assistant-ui's Assistant Transport runtime.
 *
 * `useAssistantTransportRuntime` renders *only* from `converter(state)`, and only
 * re-renders when `state` changes (it diffs `chunk.metadata.unstable_state`). So
 * streaming output must flow through STATE, not loose message parts. This
 * transport folds the agent's `AgentEvent` stream into a single assistant message
 * (ordered reasoning / tool-call / text parts), appends it after the prior
 * conversation, and pushes each update as an `update-state` set-op on the
 * assistant-stream controller — the wire format the runtime's default
 * `data-stream` decoder accumulates.
 *
 * Framework-agnostic except for two assistant-ui *type* imports (erased at
 * runtime). Pairs with the thin converter in `app/MyRuntimeProvider.tsx`.
 */
import { AgentEventType, runAgent } from "@open-agent-loops/core";
import type { RunAgentOptions } from "@open-agent-loops/core";
import type { AssistantStreamController } from "assistant-stream";
import type { ThreadMessageLike } from "@assistant-ui/react";

const FRAME_MS = 33; // ~30fps; the host owns this clock for the delta firehose.

type TextPart = { type: "text"; text: string };
type ReasoningPart = { type: "reasoning"; text: string };
type ToolPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
  argsText?: string;
  result?: unknown;
  isError?: boolean;
};
type Part = TextPart | ReasoningPart | ToolPart;

export interface TransportRun {
  /** Everything `runAgent` needs except `onEvent` — this transport supplies it. */
  run: Omit<RunAgentOptions, "onEvent">;
  /** Prior UI messages (the runtime round-trips them back in the request `state`). */
  priorMessages?: ThreadMessageLike[];
  /** The user's prompt this turn, rendered immediately as a user message. */
  userText: string;
  /** Flush cadence (ms) for the delta firehose. Default ~30fps. */
  frameMs?: number;
}

/** Run the agent, streaming its evolving assistant message as transport state. */
export async function runAgentToTransport(
  controller: AssistantStreamController,
  options: TransportRun,
): Promise<void> {
  const frameMs = options.frameMs ?? FRAME_MS;
  const parts: Part[] = [];
  const assistant = { role: "assistant", content: parts } as unknown as ThreadMessageLike;
  const messages: ThreadMessageLike[] = [
    ...(options.priorMessages ?? []),
    { role: "user", content: options.userText },
    assistant,
  ];

  let dirty = false;
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const emit = () => {
    if (closed) return;
    try {
      controller.enqueue({
        path: [],
        type: "update-state",
        // Deep-clone: the encoder may serialize lazily and we mutate `parts` in place.
        operations: [{ type: "set", path: [], value: JSON.parse(JSON.stringify({ messages })) }],
      });
      dirty = false;
    } catch {
      // Controller closed externally (client disconnected) — stop emitting, don't crash.
      closed = true;
      if (timer) clearInterval(timer);
    }
  };

  emit(); // show the user message + an empty assistant bubble immediately

  // Throttle the per-token delta firehose to ~30fps (one full-state clone per
  // frame, not per token); structural events (tool start/end) flush eagerly so
  // ordering and responsiveness never wait behind the delta clock.
  timer = setInterval(() => {
    if (dirty) emit();
  }, frameMs);

  let text: TextPart | null = null;
  let reasoning: ReasoningPart | null = null;
  const toolById = new Map<string, ToolPart>();

  try {
    await runAgent({
      ...options.run,
      onEvent: (e) => {
        switch (e.type) {
          case AgentEventType.ReasoningDelta:
            if (!reasoning) {
              reasoning = { type: "reasoning", text: "" };
              parts.push(reasoning);
              text = null;
            }
            reasoning.text += e.text;
            dirty = true; // throttled
            break;
          case AgentEventType.TextDelta:
            if (!text) {
              text = { type: "text", text: "" };
              parts.push(text);
              reasoning = null;
            }
            text.text += e.text;
            dirty = true; // throttled
            break;
          case AgentEventType.ToolStart: {
            const part: ToolPart = {
              type: "tool-call",
              toolCallId: e.toolCallId,
              toolName: e.toolName,
              args: e.args ?? {},
              argsText: JSON.stringify(e.args ?? {}),
            };
            toolById.set(e.toolCallId, part);
            parts.push(part);
            text = null;
            reasoning = null;
            emit(); // structural: flush eagerly
            break;
          }
          case AgentEventType.ToolEnd: {
            const part = toolById.get(e.toolCallId);
            if (part) {
              part.result = e.result;
              if (e.isError) part.isError = true;
            }
            emit(); // structural: flush eagerly
            break;
          }
          default:
            return; // lifecycle events (start/turn/end) don't change the rendered message
        }
      },
    });
  } catch (err) {
    // Client disconnect/cancel surfaces as an AbortError — the run was torn down
    // on purpose, so there's nothing to report. Any other error: surface it in
    // the assistant bubble instead of letting it bubble out and crash the stream.
    if (!options.run.signal?.aborted) {
      parts.push({ type: "text", text: `\n\n⚠️ The agent run failed: ${String(err)}` });
    }
  } finally {
    if (timer) clearInterval(timer);
    emit(); // final state (or the error note)
  }
}
