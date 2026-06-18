"use client";

/**
 * The agent loop as an interactive React Flow diagram — the visual replacement
 * for the ASCII sketch on the Getting Started page. Non-interactive by design
 * (no drag/zoom/pan): a clean, themed figure that scales to fit.
 *
 * Every node is colored by the **seam** it exercises — the swappable interface
 * you implement — so the pluggable pieces stand out from the fixed machinery:
 * Memory, ModelClient, Tool, and StopCondition (the loop-back gate), plus the
 * optional Hooks (drawn dashed, since they're extension points you opt into).
 * The order mirrors `agent-core/primitives/loop.ts`. The model boundary uses the
 * site's theme yellow; the other seams are fixed hues that read on the dark and
 * light checkerboard alike.
 */

import {
  Handle,
  type Edge,
  type Node,
  type NodeProps,
  MarkerType,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const SEAM = {
  memory: "#3b82f6", // Memory — conversation storage
  model: "var(--color-fd-primary)", // ModelClient — the LLM boundary (theme yellow)
  tool: "#22c55e", // Tool — a callable capability
  stop: "#a855f7", // StopCondition — when to end the run
  hook: "#f97316", // Hooks — optional extension points (transformContext, gateToolCalls)
  core: "var(--color-fd-border)", // fixed loop machinery (not a seam)
} as const;

type Seam = keyof typeof SEAM;
type StepData = { label: string; seam: Seam; kind?: "decision" | "final" };

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const color = SEAM[data.seam];
  const isHook = data.seam === "hook";
  const base: React.CSSProperties = {
    padding: "8px 14px",
    width: 188,
    boxSizing: "border-box",
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 1.25,
    textAlign: "center",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    border: `1.5px ${isHook ? "dashed" : "solid"} ${color}`,
    background: "var(--color-fd-card)",
    color: "var(--color-fd-foreground)",
    fontWeight: data.kind ? 600 : 400,
  };
  // The terminal node isn't a seam — render it as a solid "done" chip.
  const variant: React.CSSProperties =
    data.kind === "final"
      ? { background: "var(--color-fd-foreground)", color: "var(--color-fd-background)", border: "none" }
      : {};

  const hidden: React.CSSProperties = { opacity: 0, width: 1, height: 1, border: "none", background: "transparent" };
  return (
    <div style={{ ...base, ...variant }}>
      <Handle type="target" position={Position.Top} id="t" style={hidden} />
      <Handle type="source" position={Position.Bottom} id="b" style={hidden} />
      <Handle type="target" position={Position.Left} id="lt" style={hidden} />
      <Handle type="source" position={Position.Left} id="ls" style={hidden} />
      <Handle type="target" position={Position.Right} id="rt" style={hidden} />
      <Handle type="source" position={Position.Right} id="rs" style={hidden} />
      {data.label}
    </div>
  );
}

const nodeTypes = { step: StepNode };

const X = 230; // left edge of the main column
const nodes: Node<StepData>[] = [
  { id: "load",      type: "step", position: { x: X, y: 0 },   data: { label: "load history", seam: "memory" } },
  { id: "prompt",    type: "step", position: { x: X, y: 74 },  data: { label: "append prompt", seam: "memory" } },
  { id: "transform", type: "step", position: { x: X, y: 148 }, data: { label: "transformContext", seam: "hook" } },
  { id: "stream",    type: "step", position: { x: X, y: 222 }, data: { label: "stream assistant turn", seam: "model" } },
  { id: "decision",  type: "step", position: { x: X, y: 308 }, data: { label: "tool calls?", seam: "core", kind: "decision" } },
  { id: "gate",      type: "step", position: { x: X, y: 394 }, data: { label: "gate tool calls", seam: "hook" } },
  { id: "tools",     type: "step", position: { x: X, y: 468 }, data: { label: "run tools", seam: "tool" } },
  { id: "results",   type: "step", position: { x: X, y: 542 }, data: { label: "append results", seam: "memory" } },
  { id: "final",     type: "step", position: { x: X + 256, y: 308 }, data: { label: "final answer ✓", seam: "core", kind: "final" } },
];

const muted = "var(--color-fd-muted-foreground)";
const labelBg = "var(--color-fd-background)";

const edge = (
  id: string,
  source: string,
  target: string,
  opts: Partial<Edge> & { sourceHandle?: string; targetHandle?: string } = {},
  color = muted,
): Edge => ({
  id,
  source,
  target,
  type: "straight",
  animated: true,
  style: { stroke: color, strokeWidth: 1.6, strokeDasharray: "1 6", strokeLinecap: "round" },
  markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
  labelStyle: { fill: "var(--color-fd-foreground)", fontSize: 12, fontWeight: 600 },
  labelBgStyle: { fill: labelBg },
  labelBgPadding: [4, 2],
  labelBgBorderRadius: 4,
  ...opts,
});

const edges: Edge[] = [
  edge("e-load-prompt", "load", "prompt", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-prompt-transform", "prompt", "transform", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-transform-stream", "transform", "stream", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-stream-decision", "stream", "decision", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-decision-final", "decision", "final", { sourceHandle: "rs", targetHandle: "lt", label: "no" }),
  edge("e-decision-gate", "decision", "gate", { sourceHandle: "b", targetHandle: "t", label: "yes" }),
  edge("e-gate-tools", "gate", "tools", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-tools-results", "tools", "results", { sourceHandle: "b", targetHandle: "t" }),
  // Loop-back is the StopCondition seam: repeat each turn until stopWhen / maxSteps
  // / a tool's terminate. Routed up the left as orthogonal straight segments.
  edge(
    "e-results-transform",
    "results",
    "transform",
    { type: "step", sourceHandle: "ls", targetHandle: "lt", label: "repeat · stopWhen / maxSteps" },
    SEAM.stop,
  ),
];

const LEGEND: { seam: Seam; label: string }[] = [
  { seam: "memory", label: "Memory" },
  { seam: "model", label: "ModelClient" },
  { seam: "tool", label: "Tool" },
  { seam: "stop", label: "StopCondition" },
  { seam: "hook", label: "Hooks · extension" },
];

function Legend() {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px 16px",
        marginTop: 10,
        fontSize: 12,
        color: "var(--color-fd-muted-foreground)",
      }}
    >
      <span style={{ fontWeight: 600, color: "var(--color-fd-foreground)" }}>swap any seam:</span>
      {LEGEND.map(({ seam, label }) => (
        <span key={seam} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 22,
              borderTop: `2px ${seam === "hook" ? "dashed" : "solid"} ${SEAM[seam]}`,
            }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}

export function LoopDiagram() {
  return (
    <div className="not-prose my-6">
      <div
        className="w-full overflow-hidden rounded-lg"
        style={{
          height: 600,
          border: "1px solid var(--color-fd-border)",
          backgroundColor: "var(--color-fd-background)",
          // Subtle checkerboard backdrop.
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
          fitViewOptions={{ padding: 0.16 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          panOnDrag={false}
          panOnScroll={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
          style={{ background: "transparent" }}
        />
      </div>
      <Legend />
    </div>
  );
}
