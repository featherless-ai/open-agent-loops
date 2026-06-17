"use client";

/**
 * The agent loop as an interactive React Flow diagram — the visual replacement
 * for the ASCII sketch on the Getting Started page. Non-interactive by design
 * (no drag/zoom/pan): it renders as a clean, themed figure that scales to fit.
 *
 * Colors come from the site's `--color-fd-*` theme variables, so it tracks the
 * yellow/black theme (and any future retheme) without changes here.
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

type StepData = { label: string; variant?: "start" | "decision" | "final" };

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const base: React.CSSProperties = {
    padding: "8px 14px",
    width: 180,
    boxSizing: "border-box",
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 1.25,
    textAlign: "center",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    border: "1px solid #fff",
    background: "var(--color-fd-card)",
    color: "var(--color-fd-foreground)",
  };
  const variant: React.CSSProperties =
    data.variant === "final"
      ? { background: "var(--color-fd-primary)", color: "var(--color-fd-primary-foreground)", border: "none", fontWeight: 600 }
      : data.variant === "decision"
        ? { border: "1px solid var(--color-fd-primary)", fontWeight: 600 }
        : data.variant === "start"
          ? { borderStyle: "dashed" }
          : {};

  // Handles are functional anchors only — hidden so the figure stays clean.
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

const nodes: Node<StepData>[] = [
  { id: "load", type: "step", position: { x: 210, y: 0 }, data: { label: "load history", variant: "start" } },
  { id: "append", type: "step", position: { x: 210, y: 86 }, data: { label: "append prompt" } },
  { id: "stream", type: "step", position: { x: 210, y: 172 }, data: { label: "stream assistant turn" } },
  { id: "decision", type: "step", position: { x: 210, y: 272 }, data: { label: "any tool calls?", variant: "decision" } },
  { id: "run", type: "step", position: { x: 210, y: 372 }, data: { label: "run tools" } },
  { id: "results", type: "step", position: { x: 210, y: 458 }, data: { label: "append results" } },
  { id: "final", type: "step", position: { x: 470, y: 272 }, data: { label: "final answer ✓", variant: "final" } },
];

const muted = "var(--color-fd-muted-foreground)";
const accent = "var(--color-fd-primary)";
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
  // Animated dotted line: round caps + a tight dash gap read as dots; `animated`
  // marches the dashes along the path.
  style: { stroke: color, strokeWidth: 1.6, strokeDasharray: "1 6", strokeLinecap: "round" },
  markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
  labelStyle: { fill: "var(--color-fd-foreground)", fontSize: 12, fontWeight: 600 },
  labelBgStyle: { fill: labelBg },
  labelBgPadding: [4, 2],
  labelBgBorderRadius: 4,
  ...opts,
});

const edges: Edge[] = [
  edge("e-load-append", "load", "append", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-append-stream", "append", "stream", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-stream-decision", "stream", "decision", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-decision-final", "decision", "final", { sourceHandle: "rs", targetHandle: "lt", label: "no" }, accent),
  edge("e-decision-run", "decision", "run", { sourceHandle: "b", targetHandle: "t", label: "yes" }),
  edge("e-run-results", "run", "results", { sourceHandle: "b", targetHandle: "t" }),
  // Loop-back up the left side — orthogonal straight segments (so it doesn't
  // cross the column), in the accent.
  edge("e-results-stream", "results", "stream", { type: "step", sourceHandle: "ls", targetHandle: "lt", label: "repeat" }, accent),
];

export function LoopDiagram() {
  return (
    <div
      className="not-prose my-6 w-full overflow-hidden rounded-lg"
      style={{
        height: 540,
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
        fitViewOptions={{ padding: 0.18 }}
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
  );
}
