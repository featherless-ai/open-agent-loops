"use client";

/**
 * The agent loop as an interactive React Flow diagram — the visual replacement
 * for the ASCII sketch on the Getting Started page. Non-interactive by design
 * (no drag/zoom/pan): a clean, themed figure that scales to fit.
 *
 * Nodes are colored by the **seam** they exercise — the swappable interface you
 * implement — so the pluggable pieces stand out from the fixed machinery:
 * Memory, ModelClient, Tool, and StopCondition (the loop-back gate). The five
 * optional Hooks are dashed: `transformContext`, `gateToolCalls`,
 * `afterToolCall`, and the two message-injection ones — `drainSteering`
 * (redirect mid-run) and `drainFollowUp` (continue past a final answer). The
 * order and placement mirror `agent-core/primitives/loop.ts`.
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
import { SEAM, SEAM_NAME, type Seam } from "./seams";

type StepData = { label: string; seam: Seam; kind?: "decision" | "final" | "input" };

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const color = SEAM[data.seam];
  const isHook = data.seam === "hook";
  const base: React.CSSProperties = {
    padding: "7px 12px",
    width: 190,
    boxSizing: "border-box",
    borderRadius: 8,
    fontSize: 12.5,
    lineHeight: 1.2,
    textAlign: "center",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    border: `1.5px ${isHook ? "dashed" : "solid"} ${color}`,
    background: "var(--color-fd-card)",
    color: "var(--color-fd-foreground)",
    fontWeight: data.kind ? 600 : 400,
  };
  // The terminal node isn't a seam — solid "done" chip; the external-input node
  // (the caller's prompt entering the loop) is a dashed grey ghost.
  const variant: React.CSSProperties =
    data.kind === "final"
      ? { background: "var(--color-fd-foreground)", color: "var(--color-fd-background)", border: "none" }
      : data.kind === "input"
        ? {
            border: "1.5px dashed var(--color-fd-muted-foreground)",
            background: "transparent",
            color: "var(--color-fd-muted-foreground)",
            fontStyle: "italic",
            fontWeight: 400,
          }
        : {};

  const hidden: React.CSSProperties = { opacity: 0, width: 1, height: 1, border: "none", background: "transparent" };
  return (
    <div style={{ ...base, ...variant }}>
      <Handle type="target" position={Position.Top} id="t" style={hidden} />
      <Handle type="source" position={Position.Top} id="ts" style={hidden} />
      <Handle type="source" position={Position.Bottom} id="b" style={hidden} />
      <Handle type="target" position={Position.Left} id="lt" style={hidden} />
      <Handle type="source" position={Position.Left} id="ls" style={hidden} />
      <Handle type="target" position={Position.Right} id="rt" style={hidden} />
      <Handle type="source" position={Position.Right} id="rs" style={hidden} />
      {data.seam !== "core" && (
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            lineHeight: 1,
            marginBottom: 3,
            color,
            opacity: 0.85,
          }}
        >
          {isHook ? `${SEAM_NAME[data.seam]} · extension` : `${SEAM_NAME[data.seam]} seam`}
        </div>
      )}
      {data.label}
    </div>
  );
}

const nodeTypes = { step: StepNode };

const X = 250; // left edge of the main column
const RX = X + 320; // right column: where the run ends
const nodes: Node<StepData>[] = [
  { id: "userPrompt", type: "step", position: { x: X - 320, y: 88 }, data: { label: "user prompt", seam: "core", kind: "input" } },
  { id: "load",      type: "step", position: { x: X, y: 0 },    data: { label: "load message history", seam: "memory" } },
  { id: "prompt",    type: "step", position: { x: X, y: 88 },   data: { label: "append prompt", seam: "memory" } },
  { id: "transform", type: "step", position: { x: X, y: 176 },  data: { label: "transformContext", seam: "hook" } },
  { id: "stream",    type: "step", position: { x: X, y: 264 },  data: { label: "stream assistant turn", seam: "model" } },
  { id: "decision",  type: "step", position: { x: X, y: 364 },  data: { label: "tool calls?", seam: "core", kind: "decision" } },
  { id: "gate",      type: "step", position: { x: X, y: 464 },  data: { label: "gateToolCalls", seam: "hook" } },
  { id: "tools",     type: "step", position: { x: X, y: 552 },  data: { label: "run tools", seam: "tool" } },
  { id: "after",     type: "step", position: { x: X, y: 640 },  data: { label: "afterToolCall", seam: "hook" } },
  { id: "results",   type: "step", position: { x: X, y: 728 },  data: { label: "append results", seam: "memory" } },
  { id: "steering",  type: "step", position: { x: X, y: 816 },  data: { label: "drainSteering", seam: "hook" } },
  { id: "stop",      type: "step", position: { x: X, y: 904 },  data: { label: "stopWhen / maxSteps?", seam: "stop", kind: "decision" } },
  { id: "followup",  type: "step", position: { x: RX, y: 364 }, data: { label: "drainFollowUp", seam: "hook" } },
  { id: "final",     type: "step", position: { x: RX, y: 476 }, data: { label: "final answer ✓", seam: "core", kind: "final" } },
  { id: "ends",      type: "step", position: { x: RX, y: 904 }, data: { label: "run ends", seam: "core", kind: "final" } },
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
  markerEnd: { type: MarkerType.ArrowClosed, color, width: 15, height: 15 },
  labelStyle: { fill: "var(--color-fd-foreground)", fontSize: 11.5, fontWeight: 600 },
  labelBgStyle: { fill: labelBg },
  labelBgPadding: [4, 2],
  labelBgBorderRadius: 4,
  ...opts,
});

const edges: Edge[] = [
  // the user's prompt enters from outside the loop (the caller supplies it)
  edge("e-input-prompt", "userPrompt", "prompt", { sourceHandle: "rs", targetHandle: "lt", label: "from caller" }),
  edge("e-load-prompt", "load", "prompt", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-prompt-transform", "prompt", "transform", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-transform-stream", "transform", "stream", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-stream-decision", "stream", "decision", { sourceHandle: "b", targetHandle: "t" }),
  // yes: the model wants tools → gate → run → after → record
  edge("e-decision-gate", "decision", "gate", { sourceHandle: "b", targetHandle: "t", label: "tool calls" }),
  edge("e-gate-tools", "gate", "tools", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-tools-after", "tools", "after", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-after-results", "after", "results", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-results-steering", "results", "steering", { sourceHandle: "b", targetHandle: "t" }),
  edge("e-steering-stop", "steering", "stop", { sourceHandle: "b", targetHandle: "t" }),
  // StopCondition gate: continue to the next turn, or end the run. steering
  // overrides terminate/stopWhen; maxSteps is the hard cap.
  edge("e-stop-transform", "stop", "transform", { type: "step", sourceHandle: "ls", targetHandle: "lt", label: "continue" }, SEAM.stop),
  edge("e-stop-ends", "stop", "ends", { sourceHandle: "rs", targetHandle: "lt", label: "stop" }, SEAM.stop),
  // no: a turn with no tool calls — drain follow-ups, else final answer
  edge("e-decision-followup", "decision", "followup", { sourceHandle: "rs", targetHandle: "lt", label: "no tools" }),
  edge("e-followup-final", "followup", "final", { sourceHandle: "b", targetHandle: "t", label: "queue empty" }),
  // follow-up re-entry: queued messages continue the run in place
  edge(
    "e-followup-transform",
    "followup",
    "transform",
    { type: "step", sourceHandle: "ts", targetHandle: "rt", label: "follow-up" },
    SEAM.hook,
  ),
];

const LEGEND: { seam: Seam; label: string }[] = [
  { seam: "memory", label: "Memory" },
  { seam: "model", label: "ModelClient" },
  { seam: "tool", label: "Tool" },
  { seam: "stop", label: "StopCondition" },
  { seam: "hook", label: "Hooks · 5 extension points" },
];

function Legend() {
  return (
    <div style={{ marginTop: 10, fontSize: 12, color: "var(--color-fd-muted-foreground)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px" }}>
        <span style={{ fontWeight: 600, color: "var(--color-fd-foreground)" }}>swap any seam:</span>
        {LEGEND.map(({ seam, label }) => (
          <span key={seam} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 22, borderTop: `2px ${seam === "hook" ? "dashed" : "solid"} ${SEAM[seam]}` }} />
            {label}
          </span>
        ))}
      </div>
      <div style={{ marginTop: 6 }}>
        Dashed grey = <strong>external input</strong> (the caller's prompt).{" "}
        <code>drainSteering</code> injects queued messages mid-run;{" "}
        <code>drainFollowUp</code> continues past a final answer — both bounded by{" "}
        <code>maxSteps</code>. Drag the nodes to rearrange.
      </div>
    </div>
  );
}

export function LoopDiagram() {
  return (
    <div className="not-prose my-6">
      <div
        className="w-full overflow-hidden rounded-lg"
        style={{
          height: 920,
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
