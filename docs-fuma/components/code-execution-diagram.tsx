"use client";

/**
 * The `code_execution` round trip as an interactive React Flow diagram — the
 * visual replacement for the ASCII sketch on the Code Execution page, in the
 * same idiom as `LoopDiagram`. Non-interactive layout (nodes are draggable, but
 * no connect/select): a clean, themed figure that scales to fit.
 *
 * Nodes are colored by **who owns them**, which is the whole point of this page:
 * the model only ASKS (yellow `ModelClient`), the SDK owns the fixed model-facing
 * contract (green — `codeExecutionTool`'s schema validation and
 * `formatCodeExecutionResult`), and YOU own the backend that actually runs the
 * code (purple, ringed — the `CodeExecutionBackend` swap point). The tool result
 * lands back in Memory (blue) and the next model turn reads it, closing the loop.
 *
 * The result is *measured* inside the sandbox — never produced by the model. The
 * order mirrors `agent-loop-core/tools/builtin/code-execution.ts` and the deny-by-default
 * `denoCodeExecutionBackend` in `deno-backends.ts`.
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

const OWNER = {
  model: "var(--color-fd-primary)", // the model — asks & reads (theme yellow)
  sdk: "#22c55e", // SDK-owned contract — tool schema + result format (green)
  backend: "#a855f7", // you own — the swap point (purple, emphasized)
  memory: "#3b82f6", // Memory — conversation history (blue)
} as const;

type Owner = keyof typeof OWNER;

// The badge shown on each node, so ownership is labeled in place — not just
// inferred from color.
const OWNER_BADGE: Record<Owner, string> = {
  model: "ModelClient · asks",
  sdk: "SDK contract",
  backend: "CodeExecutionBackend · you own",
  memory: "Memory",
};

type StepData = { label: string; detail?: string; owner: Owner; emphasize?: boolean };

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const color = OWNER[data.owner];
  const base: React.CSSProperties = {
    padding: "8px 12px",
    width: 230,
    boxSizing: "border-box",
    borderRadius: 8,
    fontSize: 12.5,
    lineHeight: 1.2,
    textAlign: "center",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    border: `1.5px solid ${color}`,
    background: "var(--color-fd-card)",
    color: "var(--color-fd-foreground)",
    fontWeight: 600,
    // The backend is the one piece you swap — give it a soft ring so the swap
    // point stands out from the fixed machinery around it.
    ...(data.emphasize ? { boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 22%, transparent)` } : {}),
  };

  const hidden: React.CSSProperties = { opacity: 0, width: 1, height: 1, border: "none", background: "transparent" };
  return (
    <div style={{ ...base }}>
      <Handle type="target" position={Position.Top} id="t" style={hidden} />
      <Handle type="source" position={Position.Top} id="ts" style={hidden} />
      <Handle type="source" position={Position.Bottom} id="b" style={hidden} />
      <Handle type="target" position={Position.Right} id="rt" style={hidden} />
      <Handle type="source" position={Position.Right} id="rs" style={hidden} />
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
        {OWNER_BADGE[data.owner]}
      </div>
      {data.label}
      {data.detail && (
        <div style={{ marginTop: 3, fontSize: 10.5, fontWeight: 400, color: "var(--color-fd-muted-foreground)" }}>
          {data.detail}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { step: StepNode };

const X = 0; // single centered column
const GAP = 132;
const nodes: Node<StepData>[] = [
  { id: "model",   type: "step", position: { x: X, y: 0 },         data: { label: "model", detail: "the model only ASKS", owner: "model" } },
  { id: "tool",    type: "step", position: { x: X, y: GAP },       data: { label: "codeExecutionTool · validate", detail: "{ language, code } vs. Zod schema", owner: "sdk" } },
  { id: "backend", type: "step", position: { x: X, y: GAP * 2 },   data: { label: "deno · sandboxed child", detail: "deny-by-default · runs the snippet for REAL", owner: "backend", emphasize: true } },
  { id: "format",  type: "step", position: { x: X, y: GAP * 3 },   data: { label: "formatCodeExecutionResult()", detail: "stdout/stderr/exitCode → one string", owner: "sdk" } },
  { id: "history", type: "step", position: { x: X, y: GAP * 4 },   data: { label: "append to message history", detail: "tool result lands in Memory", owner: "memory" } },
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
  labelStyle: { fill: "var(--color-fd-foreground)", fontSize: 11, fontWeight: 600 },
  labelBgStyle: { fill: labelBg },
  labelBgPadding: [4, 2],
  labelBgBorderRadius: 4,
  ...opts,
});

const edges: Edge[] = [
  edge("e-model-tool", "model", "tool", { sourceHandle: "b", targetHandle: "t", label: "code_execution({ language, code })" }),
  edge("e-tool-backend", "tool", "backend", { sourceHandle: "b", targetHandle: "t", label: "runAgent → backend.exec() → deno run" }),
  edge("e-backend-format", "backend", "format", { sourceHandle: "b", targetHandle: "t", label: "{ stdout, stderr, exitCode }" }),
  edge("e-format-history", "format", "history", { sourceHandle: "b", targetHandle: "t", label: '"42\\n[exit 0: ok]"' }),
  // the loop closes on the right: the result is read on the next model turn
  edge(
    "e-history-model",
    "history",
    "model",
    { type: "step", sourceHandle: "rs", targetHandle: "rt", label: "next model turn reads it" },
    OWNER.model,
  ),
];

const LEGEND: { owner: Owner; label: string }[] = [
  { owner: "model", label: "the model — asks, never computes" },
  { owner: "sdk", label: "SDK contract — fixed" },
  { owner: "backend", label: "the backend — you own (swap point)" },
  { owner: "memory", label: "Memory" },
];

function Legend() {
  return (
    <div style={{ marginTop: 10, fontSize: 12, color: "var(--color-fd-muted-foreground)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px" }}>
        <span style={{ fontWeight: 600, color: "var(--color-fd-foreground)" }}>who owns what:</span>
        {LEGEND.map(({ owner, label }) => (
          <span key={owner} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 22, borderTop: `2px solid ${OWNER[owner]}` }} />
            {label}
          </span>
        ))}
      </div>
      <div style={{ marginTop: 6 }}>
        The result is <strong>measured inside the sandbox</strong> — the model only asks; it never
        produces the output. Swap the <code>CodeExecutionBackend</code> (the ringed node) for a container or
        cloud runner and nothing else changes. Drag the nodes to rearrange.
      </div>
    </div>
  );
}

export function CodeExecutionDiagram() {
  return (
    <div className="not-prose my-6">
      <div
        className="w-full overflow-hidden rounded-lg"
        style={{
          height: 620,
          border: "1px solid var(--color-fd-border)",
          backgroundColor: "var(--color-fd-background)",
          // Subtle checkerboard backdrop — matches LoopDiagram.
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
