/**
 * Tracer — records the trajectory of an agent run for debugging.
 *
 * It's a passive observer built on the existing seams, so the loop never knows
 * it's there:
 *   - `tracer.sink`         -> pass as runAgent({ onEvent })                  (agent events)
 *   - `tracer.onRawRequest` -> pass as OpenAICompatibleModel({ onRawRequest }) (request wire)
 *   - `tracer.onRawSSE`     -> pass as OpenAICompatibleModel({ onRawSSE })     (response wire)
 *   - `tracer.onRequest`    -> pass as OpenAICompatibleModel({ onRequest })    (run config -> meta)
 *   - `tracer.observe(model)` -> wrap a ModelClient                           (stream events)
 *
 * Every captured item becomes a timestamped `TraceEntry` in one ordered
 * timeline (`entries`). From that you can:
 *   - `format()`           a full, human-readable timeline
 *   - `trajectory()`       the run folded into (action -> observations) pairs
 *   - `formatTrajectory()` a compact per-turn summary
 *   - `toJSONL()`          one JSON object per line, for tooling / storage
 *
 * Capture is best-effort and non-throwing: a tracer must never break a run.
 */

import type { AgentEvent, ToolArguments } from "../types";
import { AgentEventType, contentToText, isAssistantMessage, Role } from "../types";
import type { ModelClient, ModelRequest, StreamEvent } from "../model.types";
import { StreamEventType } from "../model.types";
import type { EventSink } from "../types";
import { AsyncWriter } from "./async-writer";
import type { AsyncWriterOptions } from "./async-writer";
import { toCurl } from "./to-curl";
import type { ToCurlOptions } from "./to-curl";
import type {
  CompactEntry,
  DisclosureStep,
  RawRequest,
  RawSSE,
  RequestSnapshot,
  TraceEntry,
  TraceMeta,
  TraceSource,
  TrajectoryStep,
  TrajectoryTool,
} from "./tracer.types";

export interface TracerOptions {
  /** Clock, injectable for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Called with each entry as it's recorded — e.g. to live-print a trace. */
  onEntry?: (entry: TraceEntry) => void;
  /**
   * Synchronous live JSON logging: called with `JSON.stringify(entry)` inline as
   * each entry is recorded. Use for cheap sinks (an array, `console.log`). For
   * file/network I/O prefer `write` (async, batched, off the hot path).
   */
  log?: (line: string) => void;
  /**
   * Async batched JSON logging: receives compact JSON lines in batches, off the
   * agent loop's hot path (fire-and-forget, queued). Wire to a file/socket, e.g.
   * `{ write: (lines) => appendFile("trace.jsonl", lines.join("\n") + "\n") }`.
   * Call `await tracer.flush()` at run end so the tail isn't lost.
   */
  write?: (lines: string[]) => void | Promise<void>;
  /** Tuning for the async `write` queue (batch size, backpressure threshold). */
  writerOptions?: AsyncWriterOptions;
  /**
   * Auto-drain the async `write` queue when the run ends (on the `agent_end`
   * event). The loop awaits that event, so `runAgent` resolves only once the
   * trace is fully written — you never have to call `flush()` yourself. Default
   * true; set false to manage draining manually (e.g. a writer reused across
   * runs). No effect without `write`. */
  flushOnEnd?: boolean;
  /** Keep at most this many entries (ring buffer). Default: unbounded. */
  limit?: number;
  /** Seed run metadata (model, params, system, ...) up front. */
  meta?: TraceMeta;
}

/** The full trace as one JSON-serializable document: run config + timeline. */
export interface TraceDocument {
  meta: TraceMeta;
  /** Epoch ms of the first entry — the absolute base for every entry's `dt`. */
  startedAt?: number;
  durationMs: number;
  /** Compact entries (see `CompactEntry`): flattened, `label`/`t` dropped. */
  entries: CompactEntry[];
}

export interface FormatOptions {
  /** Truncate long values (deltas, results, SSE lines) to this many chars. Default 80. */
  maxValueLength?: number;
  /** Only include entries from these sources. Default: all. */
  sources?: TraceSource[];
}

export class Tracer {
  /** Every captured record, in arrival order. */
  readonly entries: TraceEntry[] = [];

  /** Run-level config: model, params, system, tools, sessionId. */
  meta: TraceMeta;

  private seq = 0;
  private originT: number | undefined;
  private readonly now: () => number;
  private readonly onEntry: ((entry: TraceEntry) => void) | undefined;
  private readonly log: ((line: string) => void) | undefined;
  private readonly writer: AsyncWriter | undefined;
  private readonly flushOnEnd: boolean;
  private readonly limit: number | undefined;

  constructor(options: TracerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.onEntry = options.onEntry;
    this.log = options.log;
    this.writer = options.write ? new AsyncWriter(options.write, options.writerOptions) : undefined;
    this.flushOnEnd = options.flushOnEnd ?? true;
    this.limit = options.limit;
    this.meta = { ...options.meta };
  }

  /**
   * Flush the async `write` queue and await the sink. Call once at run end so the
   * tail isn't lost (no-op when only the synchronous `log` is used).
   */
  async flush(): Promise<void> {
    await this.writer?.flush();
  }

  /**
   * Merge run metadata, ignoring `undefined` fields so partial taps don't clear
   * what's already known.
   */
  setMeta(partial: Partial<TraceMeta>): void {
    for (const [key, value] of Object.entries(partial)) {
      if (value !== undefined) (this.meta as Record<string, unknown>)[key] = value;
    }
  }

  /**
   * EventSink for `runAgent({ onEvent })`: captures the agent's events. Returns
   * the writer's backpressure promise, which the loop awaits — so a full async
   * `write` queue throttles the run rather than growing unbounded.
   */
  readonly sink: EventSink = (event: AgentEvent) => {
    // agent_start carries the run config, so a sink-only setup still records
    // the session, system prompt, and available tools.
    if (event.type === AgentEventType.AgentStart) {
      this.setMeta({ sessionId: event.sessionId, system: event.system, tools: event.tools });
    }
    const back = this.record("agent", event.type, event);
    // The run is over: drain the write queue here. The loop awaits agent_end, so
    // runAgent resolves only once the whole trace is written — no manual flush().
    if (event.type === AgentEventType.AgentEnd && this.flushOnEnd && this.writer) {
      return Promise.resolve(back).then(() => this.flush());
    }
    return back;
  };

  /** Tap for `OpenAICompatibleModel({ onRawSSE })`: captures raw response-wire lines (fire-and-forget). */
  readonly onRawSSE = (line: string): void => {
    void this.record("sse", "sse", { line } satisfies RawSSE);
  };

  /**
   * Tap for `OpenAICompatibleModel({ onRawRequest })`: captures the full
   * assembled request body off the wire — the exact JSON POSTed to the model,
   * with the complete tool-call history. One entry per model turn. Together with
   * `meta.baseURL` (from `onRequest`) these reconstruct a reproducible `curl`.
   */
  readonly onRawRequest = (body: unknown): void => {
    void this.record("model", "request_body", { type: "request_body", body } satisfies RawRequest);
  };

  /**
   * Tap for `OpenAICompatibleModel({ onRequest })`: records the model id, base
   * URL, sampling params, and system prompt into `meta`.
   */
  readonly onRequest = (info: {
    model?: string;
    baseURL?: string;
    params?: Record<string, unknown>;
    system?: string;
  }): void => {
    this.setMeta(info);
  };

  /**
   * Wrap a ModelClient so its StreamEvents are captured (finer grain) and the
   * system prompt + tool names are pulled from each request into `meta`.
   */
  observe(model: ModelClient): ModelClient {
    const self = this;
    return {
      stream: (request: ModelRequest) => {
        self.captureRequest(request);
        // Per-turn disclosure snapshot: what the model can see/use this turn.
        const snapshot = self.record("model", "request", {
          type: "request",
          tools: request.tools?.map((spec) => spec.name) ?? [],
          system: request.system !== undefined,
          messages: request.messages.length,
        });
        const inner = model.stream(request);
        return (async function* () {
          await snapshot; // honor writer backpressure before streaming
          for await (const event of inner) {
            await self.record("model", event.type, event);
            yield event;
          }
        })();
      },
    };
  }

  /** Pull system prompt + tool specs off a request into `meta` (first one wins). */
  private captureRequest(request: ModelRequest): void {
    const patch: Partial<TraceMeta> = {};
    if (this.meta.system === undefined) patch.system = request.system;
    if (this.meta.tools === undefined && request.tools?.length) patch.tools = request.tools;
    this.setMeta(patch);
  }

  /**
   * Append one timestamped entry. Never throws — observation must not break a
   * run. Returns the async writer's backpressure promise (only when its queue is
   * full); an awaiting caller (`sink`, `observe`) is throttled, others ignore it.
   */
  private record(source: TraceSource, label: string, data: TraceEntry["data"]): void | Promise<void> {
    try {
      const t = this.now();
      if (this.originT === undefined) this.originT = t;
      const entry: TraceEntry = { seq: this.seq++, t, dt: t - this.originT, source, label, data };
      this.entries.push(entry);
      if (this.limit !== undefined && this.entries.length > this.limit) this.entries.shift();
      this.onEntry?.(entry);
      if (this.log || this.writer) {
        const line = jsonLine(entry);
        this.log?.(line);
        if (this.writer) return this.writer.enqueue(line);
      }
    } catch {
      // best-effort: a tracer must never throw into the run it observes.
    }
  }

  /** Total wall-clock span of the trace (ms), or 0 if empty. */
  get durationMs(): number {
    if (this.entries.length === 0) return 0;
    return this.entries[this.entries.length - 1]!.dt;
  }

  /** Epoch ms of the first recorded entry — the base for every entry's `dt`. */
  get startedAt(): number | undefined {
    return this.originT;
  }

  /** Drop all recorded entries and metadata, and reset the clock origin. */
  clear(): void {
    this.entries.length = 0;
    this.seq = 0;
    this.originT = undefined;
    this.meta = {};
  }

  /** The whole trace as one JSON document: run config + compact timeline. */
  toJSON(): TraceDocument {
    return {
      meta: this.meta,
      startedAt: this.originT,
      durationMs: this.durationMs,
      entries: this.entries.map(serialize),
    };
  }

  /**
   * Fold the agent events into one (action -> observations) pair per model turn.
   * `assistant` is the action; `tools` are the observations it produced. Built
   * only from "agent" entries, so it works whether or not SSE/model capture is on.
   */
  trajectory(): TrajectoryStep[] {
    const steps: TrajectoryStep[] = [];
    let current: TrajectoryStep | undefined;
    const toolStartT = new Map<string, number>();

    const closeCurrent = (until: number) => {
      if (current) current.durationMs = until - turnStartT;
    };
    let turnStartT = 0;

    for (const entry of this.entries) {
      if (entry.source !== "agent") continue;
      const event = entry.data as AgentEvent;

      switch (event.type) {
        case AgentEventType.TurnStart: {
          closeCurrent(entry.t);
          turnStartT = entry.t;
          current = { step: event.step, tools: [] };
          steps.push(current);
          break;
        }
        case AgentEventType.Message: {
          if (current && event.message.role === Role.Assistant) current.assistant = event.message;
          break;
        }
        case AgentEventType.MessageInjected: {
          // A steering/follow-up turn injected after the current step's action —
          // attach it so the redirect shows in the folded trajectory, not just
          // the raw timeline.
          if (current) (current.injected ??= []).push({ origin: event.origin, message: event.message });
          break;
        }
        case AgentEventType.ToolStart: {
          toolStartT.set(event.toolCallId, entry.t);
          current?.tools.push({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args as ToolArguments,
          });
          break;
        }
        case AgentEventType.ToolEnd: {
          const tool = findTool(current, event.toolCallId);
          if (tool) {
            tool.result = event.result;
            tool.isError = event.isError;
            const started = toolStartT.get(event.toolCallId);
            if (started !== undefined) tool.durationMs = entry.t - started;
          }
          break;
        }
        case AgentEventType.AgentEnd: {
          closeCurrent(entry.t);
          break;
        }
      }
    }
    return steps;
  }

  /** Full timeline, one entry per line: `[+12ms] agent  tool_end  weather ok → "..."`. */
  format(options: FormatOptions = {}): string {
    const maxLen = maxLenOf(options);
    const allow = options.sources ? new Set(options.sources) : undefined;
    const rows = this.entries.filter((e) => !allow || allow.has(e.source));

    const header = `trace · ${plural(rows.length, "entry", "entries")} · ${this.durationMs}ms`;
    const metaLines = this.metaSummary(maxLen);
    const lines = rows.map((entry) => {
      const ts = `+${entry.dt}ms`.padStart(8);
      const src = entry.source.padEnd(6);
      const label = entry.label.padEnd(16);
      return `[${ts}] ${src} ${label} ${describe(entry, maxLen)}`.trimEnd();
    });
    return [header, ...metaLines, ...lines].join("\n");
  }

  /** Render the captured run config (model, params, system, tools) as lines. */
  private metaSummary(maxLen: number): string[] {
    const { sessionId, model, params, system, tools } = this.meta;
    const lines: string[] = [];
    if (sessionId) lines.push(`  session: ${sessionId}`);
    if (model) lines.push(`  model:   ${model}`);
    if (params && Object.keys(params).length) lines.push(`  params:  ${truncate(JSON.stringify(params), maxLen)}`);
    if (system) lines.push(`  system:  ${truncate(system, maxLen)}`);
    if (tools?.length) {
      lines.push(`  tools:   ${tools.length}`);
      for (const tool of tools) lines.push(`    - ${tool.name}: ${truncate(tool.description, maxLen)}`);
    }
    return lines;
  }

  /** Compact per-turn view: the action and its observations, with timings. */
  formatTrajectory(options: FormatOptions = {}): string {
    const maxLen = maxLenOf(options);
    const steps = this.trajectory();
    const out: string[] = [
      `trajectory · ${plural(steps.length, "turn")}`,
      ...this.metaSummary(maxLen),
    ];

    for (const step of steps) {
      const dur = step.durationMs !== undefined ? ` (${step.durationMs}ms)` : "";
      out.push(`turn ${step.step}${dur}`);

      const a = step.assistant;
      if (a?.reasoning) out.push(`  reasoning: ${truncate(a.reasoning, maxLen)}`);
      if (a?.content) out.push(`  assistant: ${truncate(a.content, maxLen)}`);

      for (const tool of step.tools) {
        const args = tool.args ? truncate(JSON.stringify(tool.args), maxLen) : "{}";
        const td = tool.durationMs !== undefined ? ` ${tool.durationMs}ms` : "";
        const status = tool.isError ? "ERROR" : "ok";
        out.push(`  → ${tool.toolName}(${args})${td} ${status}`);
        if (tool.result !== undefined) out.push(`      ${truncate(tool.result, maxLen)}`);
      }

      for (const inj of step.injected ?? []) {
        out.push(`  ↪ ${inj.origin}: ${truncate(contentToText(inj.message.content), maxLen)}`);
      }
    }
    return out.join("\n");
  }

  /**
   * The progressive-disclosure timeline: one step per captured request, each
   * diffed against the previous to show tools added/removed and how the context
   * window grew. Requires `observe()` (the only seam that sees the request).
   */
  disclosure(): DisclosureStep[] {
    const snapshots = this.entries.filter(
      (e): e is TraceEntry & { data: RequestSnapshot } =>
        e.source === "model" && (e.data as { type?: string }).type === "request",
    );

    let prevTools: string[] = [];
    let prevMessages = 0;
    return snapshots.map((entry, index) => {
      const snap = entry.data;
      const step: DisclosureStep = {
        turn: index + 1,
        dt: entry.dt,
        tools: snap.tools,
        addedTools: snap.tools.filter((t) => !prevTools.includes(t)),
        removedTools: prevTools.filter((t) => !snap.tools.includes(t)),
        system: snap.system,
        messages: snap.messages,
        messagesDelta: index === 0 ? snap.messages : snap.messages - prevMessages,
      };
      prevTools = snap.tools;
      prevMessages = snap.messages;
      return step;
    });
  }

  /** Compact view of how disclosure evolved: tools ± and context size per turn. */
  formatDisclosure(options: FormatOptions = {}): string {
    const maxLen = maxLenOf(options);
    const steps = this.disclosure();
    const out: string[] = [`disclosure · ${plural(steps.length, "turn")}`];
    for (const step of steps) {
      const added = step.addedTools.length ? ` +${step.addedTools.join(" +")}` : "";
      const removed = step.removedTools.length ? ` -${step.removedTools.join(" -")}` : "";
      const delta = step.messagesDelta ? ` (${step.messagesDelta > 0 ? "+" : ""}${step.messagesDelta})` : "";
      const toolList = step.tools.length ? truncate(step.tools.join(", "), maxLen) : "—";
      out.push(
        `  turn ${step.turn} (+${step.dt}ms)  tools[${step.tools.length}]: ${toolList}${added}${removed}  ctx=${step.messages}${delta}`,
      );
    }
    return out.join("\n");
  }

  /**
   * The request body POSTed each model turn, in turn order — the exact JSON the
   * provider sent, with the growing tool-call history. The structured accessor
   * for the request wire (the `request_body` entries from `onRawRequest`): it
   * owns the label filter and unwraps the {@link RawRequest} payload, so callers
   * don't reach into `entries`/`data`. Pair to `curls()` like `trajectory()` /
   * `formatTrajectory()`. Empty unless `onRawRequest` is wired.
   */
  requests(): unknown[] {
    return this.entries
      .filter((e) => e.source === "model" && e.label === "request_body")
      .map((e) => (e.data as RawRequest).body);
  }

  /**
   * Every captured request rendered as a runnable `curl`, in turn order — paste
   * any to replay that exact call. Maps `requests()` through {@link toCurl},
   * defaulting `baseURL` from `meta.baseURL` (seeded by `onRequest`) so the call
   * site doesn't stitch the endpoint together. Pass `baseURL` to override; the
   * rest of {@link ToCurlOptions} (`apiKeyEnv`, `stream`, `pretty`, `path`) pass
   * straight through.
   *
   * @throws if no `baseURL` is known — wire `onRequest`, or pass `options.baseURL`.
   */
  curls(options: Omit<ToCurlOptions, "baseURL"> & { baseURL?: string } = {}): string[] {
    const baseURL = options.baseURL ?? this.meta.baseURL;
    if (!baseURL) {
      throw new Error("Tracer.curls(): no baseURL — wire onRequest to capture it, or pass options.baseURL.");
    }
    return this.requests().map((body) => toCurl(body, { ...options, baseURL }));
  }

  /** One compact JSON object per line — machine-readable, append-friendly. */
  toJSONL(): string {
    return this.entries.map(jsonLine).join("\n");
  }
}

/**
 * Compact a `TraceEntry` for serialization: flatten `data` up and drop the
 * redundant `label` (== `data.type`) and absolute `t` (keep relative `dt`;
 * absolute time is `startedAt + dt`). See `CompactEntry`.
 */
function serialize(entry: TraceEntry): CompactEntry {
  return { seq: entry.seq, dt: entry.dt, source: entry.source, ...entry.data } as CompactEntry;
}

function findTool(step: TrajectoryStep | undefined, toolCallId: string): TrajectoryTool | undefined {
  return step?.tools.find((tool) => tool.toolCallId === toolCallId);
}

/** Render the human-readable detail for one entry, by event/source kind. */
function describe(entry: TraceEntry, maxLen: number): string {
  if (entry.source === "sse") return truncate((entry.data as RawSSE).line, maxLen);

  const data = entry.data as AgentEvent | StreamEvent | RequestSnapshot | RawRequest;
  switch (data.type) {
    case "request":
      return `tools=${data.tools.length} msgs=${data.messages}${data.system ? " +system" : ""}`;
    case "request_body": {
      const body = (data.body ?? {}) as { messages?: unknown[]; tools?: unknown[] };
      const msgs = Array.isArray(body.messages) ? body.messages.length : 0;
      const tools = Array.isArray(body.tools) ? body.tools.length : 0;
      return `body msgs=${msgs} tools=${tools}`;
    }
    case AgentEventType.AgentStart:
      return `session=${data.sessionId}${data.tools?.length ? ` tools=${data.tools.length}` : ""}`;
    case AgentEventType.TurnStart:
      return `step ${data.step}`;
    case AgentEventType.ReasoningDelta:
    case AgentEventType.TextDelta:
      return `"${truncate(data.text, maxLen)}"`;
    case AgentEventType.Message: {
      const m = data.message;
      const calls = isAssistantMessage(m) && m.tool_calls?.length ? ` tool_calls=${m.tool_calls.length}` : "";
      const text = contentToText(m.content);
      const body = text ? ` "${truncate(text, maxLen)}"` : "";
      return `${m.role}${calls}${body}`;
    }
    case AgentEventType.MessageInjected: {
      const text = contentToText(data.message.content);
      return `${data.origin} ${data.message.role}${text ? ` "${truncate(text, maxLen)}"` : ""}`;
    }
    case AgentEventType.ToolStart:
      return callSig(data.toolName, data.args, maxLen);
    case AgentEventType.ToolEnd:
      return `${data.toolName} ${data.isError ? "ERROR" : "ok"} → "${truncate(data.result, maxLen)}"`;
    case StreamEventType.ToolCall:
      return callSig(data.toolCall.function.name, data.toolCall.function.arguments, maxLen);
    case StreamEventType.Done:
      return `assistant${data.message.tool_calls?.length ? ` tool_calls=${data.message.tool_calls.length}` : ""}`;
    case StreamEventType.Error:
      return `error: ${truncate(data.error.message, maxLen)}`;
    case AgentEventType.AgentEnd:
      return `steps=${data.steps}`;
    default:
      return "";
  }
}

/** Default truncation width for the human-readable renderers. */
const DEFAULT_MAX_LEN = 80;

function maxLenOf(options: FormatOptions): number {
  return options.maxValueLength ?? DEFAULT_MAX_LEN;
}

/** `3, "turn"` -> `"3 turns"`; `1, "entry", "entries"` -> `"1 entry"`. */
function plural(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** The compact JSON line for one entry — used by live `log` and `toJSONL`. */
function jsonLine(entry: TraceEntry): string {
  return JSON.stringify(serialize(entry));
}

/** Render a tool call signature `name(args)`; `args` may be an object or a JSON string. */
function callSig(name: string, args: unknown, maxLen: number): string {
  const text = typeof args === "string" ? args : JSON.stringify(args);
  return `${name}(${truncate(text, maxLen)})`;
}

/** Collapse newlines and clip to `maxLen`, marking truncation with an ellipsis. */
function truncate(value: string, maxLen: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length <= maxLen ? oneLine : `${oneLine.slice(0, maxLen - 1)}…`;
}
