/**
 * A scripted agent run — the single source of truth for the landing page's
 * animations (the transit hero, the bring-your-own-front-end panels, and the
 * trace replay all consume it).
 *
 * The event shapes mirror `agent-core/types/events.ts` **by their wire values**
 * (`"text_delta"`, `"tool_start"`, …) so the demo reads like a real trace — but
 * the types are declared locally so the docs site stays fully decoupled from the
 * core build (no dep link, no `dist/` import). If the real `AgentEvent` union
 * gains a variant, mirror it here only if the landing page needs to show it.
 *
 * The demo is the classic one: "What's the weather in Paris?" → a `weather` tool
 * call → a final answer. Two model turns, one tool call.
 */

/** A station on the transit map — the seam a given event lights up. */
export type Station = "memory" | "model" | "tool" | "stop";

/** Faithful subset of agent-core's AgentEvent, by wire value. */
export type DemoEvent =
  | { type: "agent_start"; sessionId: string }
  | { type: "turn_start"; step: number }
  | { type: "reasoning_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_end"; toolCallId: string; toolName: string; result: string; isError: boolean }
  | { type: "agent_end"; steps: number };

/**
 * One scripted step: the real event, plus animation-only metadata — which
 * station to pulse and how long to dwell before the next step. Consumers that
 * only render the trace (BYO panels, trace replay) ignore `station`/`holdMs`.
 */
export type ScriptStep = {
  event: DemoEvent;
  /** Station to pulse when this event fires (transit hero). */
  station?: Station;
  /** Dwell, in ms, before advancing to the next step. */
  holdMs: number;
};

export const LOOP_SCRIPT: ScriptStep[] = [
  { event: { type: "agent_start", sessionId: "paris-demo" }, station: "memory", holdMs: 650 },
  { event: { type: "turn_start", step: 1 }, station: "memory", holdMs: 550 },
  {
    event: {
      type: "reasoning_delta",
      text: "The user wants the weather in Paris — I'll call the weather tool.",
    },
    station: "model",
    holdMs: 1200,
  },
  {
    event: { type: "tool_start", toolCallId: "call_0", toolName: "weather", args: { city: "Paris" } },
    station: "tool",
    holdMs: 950,
  },
  {
    event: {
      type: "tool_end",
      toolCallId: "call_0",
      toolName: "weather",
      result: "Sunny in Paris",
      isError: false,
    },
    station: "tool",
    holdMs: 750,
  },
  { event: { type: "turn_start", step: 2 }, station: "stop", holdMs: 550 },
  { event: { type: "text_delta", text: "It's sunny " }, station: "model", holdMs: 380 },
  { event: { type: "text_delta", text: "in Paris." }, station: "model", holdMs: 750 },
  { event: { type: "agent_end", steps: 2 }, station: "stop", holdMs: 1400 },
];

/** Total scripted duration (ms) — handy for sizing scrubbers / loops. */
export const LOOP_DURATION_MS = LOOP_SCRIPT.reduce((sum, s) => sum + s.holdMs, 0);
