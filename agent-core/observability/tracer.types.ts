/**
 * Trace data types — the timestamped record of an agent run.
 *
 * A trace is an ordered list of `TraceEntry`s, each stamped with wall-clock time
 * and a relative offset from the run's start. Entries come from three seams:
 *   - "agent"  AgentEvents emitted by the loop (the trajectory)
 *   - "model"  StreamEvents at the ModelClient boundary (optional, finer grain)
 *   - "sse"    raw Server-Sent-Events lines off the wire (optional, finest grain)
 *
 * `TrajectoryStep` is the higher-level view: agent events folded into one
 * (action -> observations) pair per model turn — the assistant's decision and
 * the tool results it produced — which is what you usually read when debugging.
 */

import type { AgentEvent, AssistantMessage, ToolArguments } from "../types";
import type { StreamEvent, ToolSpec } from "../model.types";

/** Origin seam of a trace entry. */
export type TraceSource = "agent" | "model" | "sse";

/**
 * Run-level configuration captured alongside the timeline — the context you
 * need to reproduce or compare a run. Filled in from whatever taps are wired:
 * `sessionId` from the agent's `agent_start`, `system`/`tools` from the model
 * request (via `observe`), and `model`/`params`/`system` from a provider's
 * `onRequest` tap (e.g. `OpenAICompatibleModel`).
 */
export interface TraceMeta {
  sessionId?: string;
  /** Model id, e.g. "deepseek-ai/DeepSeek-V3.1". */
  model?: string;
  /** Sampling parameters (temperature, top_p, max_tokens, ...). */
  params?: Record<string, unknown>;
  /** The system prompt for the run. */
  system?: string;
  /** The tools made available to the model — full specs (name, description, schema). */
  tools?: ToolSpec[];
}

/** A raw SSE line captured off the wire. */
export interface RawSSE {
  line: string;
}

/**
 * A snapshot of what was disclosed to the model on one request (one turn) —
 * captured by `observe()`, which sees every `ModelRequest`. Tracing these across
 * a run is how you watch *progressive disclosure*: the tool surface, the system
 * prompt, and the size of the context window as they change turn to turn.
 */
export interface RequestSnapshot {
  type: "request";
  /** Tool names available to the model this turn. */
  tools: string[];
  /** Whether a system prompt was present this turn. */
  system: boolean;
  /** Number of messages in the context window this turn. */
  messages: number;
}

/** One timestamped record in a trace. */
export interface TraceEntry {
  /** Monotonic 0-based sequence number within this trace. */
  seq: number;
  /** Wall-clock capture time (ms since epoch). */
  t: number;
  /** Milliseconds since the first entry — the relative timeline. */
  dt: number;
  source: TraceSource;
  /** Short kind label: the event `type`, or "sse" for a raw line. */
  label: string;
  /** Payload: an AgentEvent, a model StreamEvent, a request snapshot, or a raw SSE line. */
  data: AgentEvent | StreamEvent | RequestSnapshot | RawSSE;
}

/**
 * Compact serialization of a `TraceEntry` — the on-disk / wire shape. The `data`
 * payload is flattened up, and the two redundant fields are dropped: `label`
 * (always equals `data.type`) and the absolute `t` (reconstruct it from the
 * document's `startedAt` + this entry's `dt`). The in-memory `TraceEntry` keeps
 * the richer shape for programmatic access; only JSON output is compacted.
 *
 * Example: `{"seq":2,"dt":7,"source":"agent","type":"turn_start","step":1}`.
 */
export type CompactEntry = { seq: number; dt: number; source: TraceSource } & (
  | AgentEvent
  | StreamEvent
  | RequestSnapshot
  | RawSSE
);

/** One tool invocation within a turn: the call and its outcome. */
export interface TrajectoryTool {
  toolCallId: string;
  toolName: string;
  args?: ToolArguments;
  result?: string;
  isError?: boolean;
  /** Wall-clock ms from `tool_start` to `tool_end`. */
  durationMs?: number;
}

/**
 * One turn of the progressive-disclosure timeline: what was disclosed to the
 * model this turn, and what changed since the previous turn. Built by diffing
 * consecutive `RequestSnapshot`s.
 */
export interface DisclosureStep {
  /** 1-based turn index among captured requests. */
  turn: number;
  /** ms from the run start (the snapshot's `dt`). */
  dt: number;
  /** Tool names available this turn. */
  tools: string[];
  /** Tools newly available since the previous turn. */
  addedTools: string[];
  /** Tools no longer available since the previous turn. */
  removedTools: string[];
  /** Whether a system prompt was present this turn. */
  system: boolean;
  /** Context window size (message count) this turn. */
  messages: number;
  /** Change in context size vs the previous turn (full size on turn 1). */
  messagesDelta: number;
}

/**
 * One turn of the agent's trajectory: the model's action paired with the
 * observations it produced. `assistant` is the action (text and/or tool calls);
 * `tools` are the observations (each call's result).
 */
export interface TrajectoryStep {
  step: number;
  /** The assistant message produced this turn (the action). */
  assistant?: AssistantMessage;
  /** Tool calls requested this turn and their results (the observations). */
  tools: TrajectoryTool[];
  /** Wall-clock ms from this turn's `turn_start` to the next turn / end. */
  durationMs?: number;
}
