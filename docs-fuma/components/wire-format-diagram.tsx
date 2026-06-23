"use client";

/**
 * One conversation as an interactive **timeline** (React Flow) — the visual
 * replacement for the ASCII sketch on the Messages & the Wire Format page, in the
 * same themed idiom as `LoopDiagram` and `CodeExecutionDiagram`.
 *
 * The conversation IS one ordered array, so the figure is one vertical stack:
 * the six message-array entries, top to bottom in array order, time flowing down
 * (a labelled time axis with turn markers runs down the left). Each card is
 * stamped with **who produced it** — You (system + user), the API provider (the
 * assistant turns), or the hosting machine (the tool results) — via colour, a
 * `produced by` header, and a coloured left stripe.
 *
 * The arrows between cards are the transitions; the two that **cross the wire**
 * (the POST to the model, which re-sends the whole growing array) are highlighted
 * yellow. Mirrors `agent-loop-core/primitives/loop.ts`.
 */

import {
  Controls,
  Handle,
  type Edge,
  type Node,
  type NodeProps,
  MarkerType,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Producers and the role each one writes — colour ties the two together.
const PRODUCER = {
  you: { label: "You", color: "#3b82f6" }, // writes system + user
  api: { label: "API provider", color: "var(--color-fd-primary)" }, // writes the assistant turns
  host: { label: "Hosting machine", color: "#22c55e" }, // writes the tool results
} as const;

type ProducerId = keyof typeof PRODUCER;

const WIRE = "var(--color-fd-primary)"; // arrows that cross the network
const LOCAL = "var(--color-fd-muted-foreground)"; // transitions that stay on your machine

const CX = 440; // centre of the message column
const CARD_W = 320;
const AXIS_X = 150; // the time axis runs down here
const TURN_X = 40; // turn markers sit left of the axis

type Card = { id: string; producer: ProducerId; role: string; y: number; label: string; detail: string };
const CARDS: Card[] = [
  { id: "m-sys", producer: "you", role: "system", y: 24, label: '"You are a weather assistant."', detail: "instructions · always first" },
  { id: "m-user", producer: "you", role: "user", y: 138, label: '"weather in NYC and London?"', detail: "the prompt" },
  { id: "m-a1", producer: "api", role: "assistant", y: 258, label: 'content: ""  ·  tool_calls', detail: "call_a + call_b (parallel)" },
  { id: "m-ta", producer: "host", role: "tool", y: 378, label: "call_a → get_weather(NYC)", detail: '"72°F and sunny"' },
  { id: "m-tb", producer: "host", role: "tool", y: 492, label: "call_b → get_weather(London)", detail: '"55°F and rainy"' },
  { id: "m-a2", producer: "api", role: "assistant", y: 612, label: '"NYC 72°F · London 55°F"', detail: "no tool_calls → final answer" },
];

const AXIS_TOP = 16;
const AXIS_BOT = 712;

type NodeData = {
  kind: "card" | "dot" | "note" | "end";
  producer?: ProducerId;
  role?: string;
  label?: string;
  detail?: string;
  color?: string;
};

const hidden: React.CSSProperties = { opacity: 0, width: 1, height: 1, border: "none", background: "transparent" };
const handles = (
  <>
    <Handle type="target" position={Position.Top} id="t" style={hidden} />
    <Handle type="source" position={Position.Bottom} id="b" style={hidden} />
    <Handle type="target" position={Position.Left} id="lt" style={hidden} />
    <Handle type="source" position={Position.Right} id="rs" style={hidden} />
  </>
);

function SeqNode({ data }: NodeProps<Node<NodeData>>) {
  if (data.kind === "dot") {
    return (
      <div style={{ width: 2, height: 2 }}>
        {handles}
      </div>
    );
  }

  if (data.kind === "note") {
    return (
      <div
        style={{
          fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: data.color ?? LOCAL,
          whiteSpace: "nowrap",
        }}
      >
        {handles}
        {data.label}
      </div>
    );
  }

  if (data.kind === "end") {
    return (
      <div
        style={{
          fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
          fontSize: 11,
          fontWeight: 600,
          color: PRODUCER.you.color,
          border: `1.5px dashed ${PRODUCER.you.color}`,
          borderRadius: 999,
          padding: "5px 14px",
          background: "var(--color-fd-card)",
          whiteSpace: "nowrap",
        }}
      >
        {handles}
        ↩ returned to You — the run result
      </div>
    );
  }

  // card
  const p = PRODUCER[data.producer!];
  return (
    <div
      style={{
        boxSizing: "border-box",
        width: CARD_W,
        textAlign: "left",
        borderRadius: 8,
        border: "1.5px solid var(--color-fd-border)",
        borderLeft: `5px solid ${p.color}`,
        background: "var(--color-fd-card)",
        color: "var(--color-fd-foreground)",
        padding: "8px 12px 9px 13px",
        fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
        lineHeight: 1.2,
      }}
    >
      {handles}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: p.color,
          }}
        >
          ▎produced by {p.label}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: "var(--color-fd-muted-foreground)",
          }}
        >
          {`"role": "${data.role}"`}
        </span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{data.label}</div>
      <div style={{ marginTop: 2, fontSize: 10.5, fontWeight: 400, color: "var(--color-fd-muted-foreground)" }}>
        {data.detail}
      </div>
    </div>
  );
}

const nodeTypes = { seq: SeqNode };

const nodes: Node<NodeData>[] = [
  // time axis endpoints + label + turn markers (down the left)
  { id: "axis-top", type: "seq", position: { x: AXIS_X, y: AXIS_TOP }, data: { kind: "dot" } },
  { id: "axis-bot", type: "seq", position: { x: AXIS_X, y: AXIS_BOT }, data: { kind: "dot" } },
  { id: "axis-label", type: "seq", position: { x: TURN_X, y: AXIS_TOP - 2 }, data: { kind: "note", label: "time ↓", color: "var(--color-fd-foreground)" } },
  { id: "turn1", type: "seq", position: { x: TURN_X, y: 150 }, data: { kind: "note", label: "turn 1", color: LOCAL } },
  { id: "turn2", type: "seq", position: { x: TURN_X, y: 624 }, data: { kind: "note", label: "turn 2", color: LOCAL } },
  // the message array, one card per entry
  ...CARDS.map(
    (c): Node<NodeData> => ({
      id: c.id,
      type: "seq",
      position: { x: CX - CARD_W / 2, y: c.y },
      data: { kind: "card", producer: c.producer, role: c.role, label: c.label, detail: c.detail },
    }),
  ),
  { id: "end", type: "seq", position: { x: CX - 130, y: 720 }, data: { kind: "end" } },
];

const labelBg = "var(--color-fd-background)";

const flow = (id: string, source: string, target: string, color: string, label?: string, wide = false): Edge => ({
  id,
  source,
  target,
  sourceHandle: "b",
  targetHandle: "t",
  type: "straight",
  animated: true,
  ...(label ? { label } : {}),
  style: { stroke: color, strokeWidth: wide ? 2.4 : 1.7, strokeDasharray: "1 6", strokeLinecap: "round" },
  markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
  labelStyle: { fill: "var(--color-fd-foreground)", fontSize: 11, fontWeight: 600 },
  labelBgStyle: { fill: labelBg },
  labelBgPadding: [5, 3],
  labelBgBorderRadius: 4,
});

const edges: Edge[] = [
  // the time axis — animated, marching downward (the direction time flows)
  {
    id: "axis",
    source: "axis-top",
    target: "axis-bot",
    sourceHandle: "b",
    targetHandle: "t",
    type: "straight",
    animated: true,
    style: { stroke: "var(--color-fd-muted-foreground)", strokeWidth: 2, strokeDasharray: "5 6", strokeLinecap: "round" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-fd-muted-foreground)", width: 14, height: 14 },
  },
  // the array, top to bottom
  flow("e-sys-user", "m-sys", "m-user", LOCAL),
  flow("e-user-a1", "m-user", "m-a1", WIRE, "request ① — POST whole array → model", true),
  flow("e-a1-ta", "m-a1", "m-ta", PRODUCER.host.color, "run both tools · parallel · local"),
  flow("e-ta-tb", "m-ta", "m-tb", PRODUCER.host.color, "appended in request order"),
  flow("e-tb-a2", "m-tb", "m-a2", WIRE, "request ② — POST whole array → model", true),
  flow("e-a2-end", "m-a2", "end", LOCAL),
];

function Legend() {
  const swatch = (c: string) => <span style={{ width: 22, borderTop: `3px solid ${c}` }} />;
  return (
    <div style={{ marginTop: 10, fontSize: 12, color: "var(--color-fd-muted-foreground)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px" }}>
        <span style={{ fontWeight: 600, color: "var(--color-fd-foreground)" }}>produced by:</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{swatch(PRODUCER.you.color)} You (system · user)</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{swatch(PRODUCER.api.color)} API provider (assistant)</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{swatch(PRODUCER.host.color)} Hosting machine (tool)</span>
      </div>
      <div style={{ marginTop: 6 }}>
        Read top to bottom — that's the message array and the order it's built.{" "}
        <strong style={{ color: "var(--color-fd-foreground)" }}>Yellow arrows cross the wire</strong> (each POST
        re-sends the <strong>whole growing array</strong>); the green steps stay local — the two tool calls run in
        parallel but their results are appended in request order. Drag the nodes to rearrange.
      </div>
    </div>
  );
}

export function WireFormatDiagram() {
  return (
    <div className="not-prose my-6">
      <div
        className="w-full overflow-hidden rounded-lg"
        style={{
          height: 680,
          border: "1px solid var(--color-fd-border)",
          backgroundColor: "var(--color-fd-background)",
          // Subtle checkerboard backdrop — matches the other diagrams.
          backgroundImage: "repeating-conic-gradient(var(--color-fd-muted) 0% 25%, transparent 0% 50%)",
          backgroundPosition: "50%",
          backgroundSize: "32px 32px",
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.14 }}
          minZoom={0.2}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false} // don't trap page scroll; use the controls / pinch
          zoomOnPinch
          zoomOnDoubleClick
          panOnDrag
          panOnScroll={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
          style={{ background: "transparent" }}
        >
          {/* zoom in / out / fit-to-view */}
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <Legend />
    </div>
  );
}
