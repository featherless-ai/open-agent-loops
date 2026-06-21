import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Tracer } from "../observability/tracer";
import { runAgent } from "../primitives/loop";
import { MockModelClient } from "../mocks/mock-model";
import { SessionMemoryStore } from "../memory/session-memory";
import { defineTool } from "../tools/tools";
import { AgentEventType, userMessage } from "../types";

/** A monotonic fake clock: each read advances by 1ms, so durations are stable. */
function clock() {
  let t = 0;
  return () => t++;
}

const weather = defineTool({
  name: "weather",
  description: "Get weather for a city",
  parameters: z.object({ city: z.string() }),
  execute: ({ city }) => ({ content: `Sunny in ${city}` }),
});

/**
 * One canonical run, observed end to end: reasoning + a tool call on turn 1, a
 * final answer on turn 2, with a system prompt and one tool. `observe()` wraps
 * the model so request snapshots + stream events are captured too.
 */
function runCanonical(tracer: Tracer) {
  return runAgent({
    model: tracer.observe(
      new MockModelClient([
        { reasoning: "User asks weather; call the tool.", toolCalls: [{ name: "weather", arguments: { city: "Paris" } }] },
        { text: "Sunny in Paris." },
      ]),
    ),
    memory: new SessionMemoryStore(),
    sessionId: "demo",
    system: "Be terse.",
    prompt: "weather in Paris?",
    tools: [weather],
    onEvent: tracer.sink,
  });
}

// ── Bucket 1: the pure pipeline (entries → views) is one input→output mapping ──
describe("Tracer: pipeline mapping", () => {
  // Golden: a canonical run maps to the expected trajectory, disclosure, meta,
  // and rendered views. One fixture exercises serialize + both folds + render.
  test("golden: maps a run to trajectory, disclosure, meta, and rendered views", async () => {
    const tracer = new Tracer({ now: clock(), meta: { model: "m", params: { temperature: 0.2 } } });
    await runCanonical(tracer);

    // trajectory: (action → observation) pairs
    const traj = tracer.trajectory();
    expect(traj).toHaveLength(2);
    expect(traj[0]!.assistant?.tool_calls).toHaveLength(1);
    expect(traj[0]!.tools[0]).toMatchObject({ toolName: "weather", args: { city: "Paris" }, result: "Sunny in Paris", isError: false });
    expect(typeof traj[0]!.tools[0]!.durationMs).toBe("number");
    expect(traj[1]!.assistant?.content).toBe("Sunny in Paris.");

    // disclosure: per-turn diff over time
    const disc = tracer.disclosure();
    expect(disc.map((d) => d.addedTools)).toEqual([["weather"], []]);
    expect(disc[1]!.messagesDelta).toBeGreaterThan(0); // context grew

    // meta: seeded model/params + system/tools/session captured from agent_start
    expect(tracer.meta).toMatchObject({ model: "m", system: "Be terse.", sessionId: "demo" });
    expect(tracer.meta.tools?.map((t) => t.name)).toEqual(["weather"]);

    // rendered views (the human-readable mapping)
    const f = tracer.format();
    expect(f).toContain("model:   m");
    expect(f).toContain("- weather:");
    expect(f).toContain("tool_end");
    expect(tracer.formatTrajectory()).toContain("→ weather");
    expect(tracer.formatDisclosure()).toContain("+weather");
  });

  // Round-trip: JSONL is a lossless compact projection of the entries; toJSON
  // bundles the same projection with meta.
  test("round-trip: JSONL is a lossless compact projection; toJSON bundles meta", async () => {
    const tracer = new Tracer({ now: clock() });
    await runCanonical(tracer);

    const lines = tracer.toJSONL().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(tracer.entries.length);
    expect(lines[0]).toMatchObject({ seq: 0, source: "agent", type: "agent_start" });
    // Compact shape: data flattened up, redundant label/t dropped.
    for (const l of lines) {
      expect(l.data).toBeUndefined();
      expect(l.label).toBeUndefined();
      expect(l.t).toBeUndefined();
    }
    // Order + identity preserved against the in-memory entries.
    expect(lines.map((l) => l.seq)).toEqual(tracer.entries.map((e) => e.seq));

    const doc = tracer.toJSON();
    expect(JSON.parse(JSON.stringify(doc.entries))).toEqual(lines);
    expect(doc.meta).toBe(tracer.meta);
    expect(typeof doc.startedAt).toBe("number");
  });
});

// ── Bucket 2: failure / edge inputs ──
describe("Tracer: edge inputs", () => {
  // Long values are truncated to keep the timeline readable.
  test("truncates long values", () => {
    const tracer = new Tracer({ now: clock() });
    tracer.sink({ type: AgentEventType.TextDelta, text: "x".repeat(500), timestamp: 0 });
    const out = tracer.format({ maxValueLength: 20 });
    expect(out).toContain("…");
    expect(out).not.toContain("x".repeat(100));
  });

  // An empty trace renders a zero header and yields empty projections.
  test("handles an empty trace", () => {
    const tracer = new Tracer({ now: clock() });
    expect(tracer.format()).toContain("0 entries");
    expect(tracer.durationMs).toBe(0);
    expect(tracer.trajectory()).toEqual([]);
    expect(tracer.disclosure()).toEqual([]);
  });

  // A failing tool is recorded as an error observation on the trajectory.
  test("marks tool errors on the trajectory", async () => {
    const boom = defineTool({
      name: "boom",
      description: "always throws",
      parameters: z.object({}),
      execute: () => { throw new Error("kaboom"); },
    });
    const tracer = new Tracer({ now: clock() });
    await runAgent({
      model: new MockModelClient([{ toolCalls: [{ name: "boom", arguments: {} }] }, { text: "done" }]),
      memory: new SessionMemoryStore(),
      sessionId: "demo",
      prompt: "go",
      tools: [boom],
      onEvent: tracer.sink,
    });
    const tool = tracer.trajectory()[0]!.tools[0]!;
    expect(tool.isError).toBe(true);
    expect(tool.result).toContain("kaboom");
  });

  // A steering injection is folded onto the step it followed, so a redirect is
  // visible in the trajectory (and rendered), not just the raw timeline.
  test("folds a steering injection onto the trajectory step", async () => {
    const tracer = new Tracer({ now: clock() });
    const queue = [userMessage({ content: "actually do B" })];
    await runAgent({
      model: new MockModelClient([
        { toolCalls: [{ name: "weather", arguments: { city: "Paris" } }] },
        { text: "ok" },
      ]),
      memory: new SessionMemoryStore(),
      sessionId: "demo",
      prompt: "go",
      tools: [weather],
      hooks: { drainSteering: () => queue.splice(0) },
      onEvent: tracer.sink,
    });

    const traj = tracer.trajectory();
    expect(traj[0]!.injected).toHaveLength(1);
    expect(traj[0]!.injected![0]!.origin).toBe("steering");
    expect(traj[0]!.injected![0]!.message.content).toBe("actually do B");
    expect(tracer.formatTrajectory()).toContain("↪ steering: actually do B");
  });

  // A ring-buffer limit keeps only the most recent entries.
  test("limit keeps the last N entries", () => {
    const tracer = new Tracer({ now: clock(), limit: 3 });
    for (let i = 0; i < 5; i++) tracer.sink({ type: AgentEventType.TurnStart, step: i, timestamp: 0 });
    expect(tracer.entries.map((e) => (e.data as { step: number }).step)).toEqual([2, 3, 4]);
  });
});

// ── Bucket 3: effectful guarantees (not input→output mappings) ──
describe("Tracer: behavior", () => {
  // Wiring: each tap lands in the timeline; agent_start populates meta.
  test("every tap captures into the timeline", async () => {
    const tracer = new Tracer({ now: clock() });
    tracer.onRawSSE('data: {"x":1}');
    await runCanonical(tracer);

    const labels = (s: string) => tracer.entries.filter((e) => e.source === s).map((e) => e.label);
    expect(labels("sse")).toEqual(["sse"]);
    expect(labels("model")).toContain("request"); // per-turn disclosure snapshot
    expect(labels("model")).toContain("done"); // model stream event
    expect(tracer.meta.sessionId).toBe("demo"); // from agent_start
  });

  // Request wire: onRawRequest lands a per-turn `request_body` entry carrying the
  // full body (with tool-call history); onRequest seeds baseURL into meta. Both
  // survive the compact projection, so a trace doc can rebuild the request.
  test("captures the request body off the wire, with baseURL in meta", async () => {
    const tracer = new Tracer({ now: clock() });
    tracer.onRequest({ model: "m", baseURL: "https://api.featherless.ai/v1" });
    tracer.onRawRequest({
      model: "m",
      stream: true,
      messages: [
        { role: "system", content: "Be terse." },
        { role: "assistant", content: "", tool_calls: [{ id: "call_0", type: "function", function: { name: "weather", arguments: '{"city":"Paris"}' } }] },
        { role: "tool", tool_call_id: "call_0", content: "Sunny in Paris" },
      ],
      tools: [{ type: "function", function: { name: "weather" } }],
    });

    // meta carries the URL host for replay
    expect(tracer.meta.baseURL).toBe("https://api.featherless.ai/v1");

    // a single model-source `request_body` entry holds the verbatim body
    const reqs = tracer.entries.filter((e) => e.source === "model" && e.label === "request_body");
    expect(reqs).toHaveLength(1);
    const body = (reqs[0]!.data as { body: { messages: unknown[]; tools: unknown[] } }).body;
    expect(body.messages).toHaveLength(3);
    expect(body.tools).toHaveLength(1);

    // it round-trips through the compact JSON projection (flattened, no `data`)
    const compact = tracer.toJSON().entries.find((e) => (e as { type?: string }).type === "request_body") as
      | { source: string; body: { messages: unknown[] } }
      | undefined;
    expect(compact?.source).toBe("model");
    expect(compact?.body.messages).toHaveLength(3);

    // the human-readable timeline summarizes it
    expect(tracer.format()).toContain("request_body");
    expect(tracer.format()).toContain("body msgs=3 tools=1");
  });

  // Non-throwing: a throwing onEntry/log callback never breaks capture.
  test("capture is non-throwing", () => {
    const tracer = new Tracer({
      now: clock(),
      onEntry: () => { throw new Error("sink boom"); },
      log: () => { throw new Error("log boom"); },
    });
    expect(() => tracer.sink({ type: AgentEventType.AgentStart, sessionId: "s", timestamp: 0 })).not.toThrow();
    expect(tracer.entries).toHaveLength(1);
  });

  // Async write: queue auto-drains on agent_end (no manual flush), in order.
  test("async write auto-flushes on agent_end, in order", async () => {
    const batches: string[][] = [];
    const tracer = new Tracer({ now: clock(), write: async (lines) => void batches.push(lines) });
    await runCanonical(tracer); // note: no tracer.flush()

    const written = batches.flat();
    expect(written).toHaveLength(tracer.entries.length);
    expect(written.map((l) => JSON.parse(l).seq)).toEqual(tracer.entries.map((e) => e.seq));
    expect(JSON.parse(written.at(-1)!).type).toBe("agent_end");
  });

  // A rejecting async writer never breaks the run it observes.
  test("a rejecting writer doesn't break the run", async () => {
    const tracer = new Tracer({ now: clock(), write: async () => { throw new Error("disk full"); } });
    const result = await runCanonical(tracer);
    await tracer.flush();
    expect(result.steps).toBeGreaterThan(0);
  });
});
