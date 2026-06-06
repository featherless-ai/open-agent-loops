<script setup lang="ts">
/**
 * Interactive, node-based architecture diagrams for agent-core, built with
 * Vue Flow (the Vue-native equivalent of React Flow). Client-only (.client.vue)
 * because Vue Flow measures the DOM, so it renders in the browser, not on the
 * server — and it goes through Nuxt's bundler, so there's no CDN to fail.
 *
 * Three views (Architecture / Composition / Runtime flow) share one canvas;
 * switching remounts VueFlow via :key so fitView re-runs cleanly.
 */
import { computed, ref } from "vue";
import { VueFlow } from "@vue-flow/core";
import type { Edge, Node } from "@vue-flow/core";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

type ViewKey = "architecture" | "composition" | "flow";

const view = ref<ViewKey>("architecture");
const tabs: { key: ViewKey; label: string }[] = [
  { key: "architecture", label: "SDK architecture" },
  { key: "composition", label: "Composition" },
  { key: "flow", label: "Runtime flow" },
];

// --- shared node styling by role -------------------------------------------
const palette = {
  consumer: { background: "#0d2b53", color: "#cfe1ff", border: "1px solid #1f6feb" },
  api: { background: "#0f2a17", color: "#bef5c8", border: "1px solid #238636" },
  core: { background: "#241a3d", color: "#e0d4ff", border: "1px solid #8957e5" },
  seam: { background: "#161b22", color: "#9fe6ff", border: "1px solid #2bb3c0" },
  builtin: { background: "#1c2128", color: "#e6edf3", border: "1px solid #444c56" },
  plug: { background: "#161b22", color: "#8b949e", border: "1px dashed #6e7681" },
} as const;

const base = (role: keyof typeof palette, width = 180) => ({
  ...palette[role],
  width: `${width}px`,
  borderRadius: "10px",
  padding: "8px 10px",
  fontSize: "12px",
  textAlign: "center" as const,
});

const n = (
  id: string,
  label: string,
  x: number,
  y: number,
  role: keyof typeof palette,
  width?: number,
): Node => ({ id, label, position: { x, y }, style: base(role, width), draggable: true });

const e = (id: string, source: string, target: string, label?: string, implementsEdge = false): Edge => ({
  id,
  source,
  target,
  label,
  animated: implementsEdge,
  style: { stroke: implementsEdge ? "#6e7681" : "#4b5563" },
  labelStyle: { fill: "#8b949e", fontSize: "11px" },
});

// --- view: SDK architecture (layered) --------------------------------------
const architecture = {
  nodes: [
    n("app", "Consumer app", 300, 0, "consumer"),
    n("run", "Public API · runAgent()", 300, 80, "api"),
    n("loop", "Core engine · loop.ts", 300, 160, "core"),
    n("model", "ModelClient", -40, 260, "seam", 150),
    n("mem", "Memory", 130, 260, "seam", 150),
    n("tool", "Tool", 300, 260, "seam", 150),
    n("stop", "StopCondition", 470, 260, "seam", 150),
    n("hook", "Hooks", 640, 260, "seam", 150),
    n("fake", "FakeModelClient", -40, 360, "builtin", 150),
    n("inmem", "InMemoryStore", 130, 360, "builtin", 150),
    n("oai", "OpenAI-compatible model", -40, 450, "plug", 170),
    n("dur", "JSONL / Redis / Vector", 130, 450, "plug", 170),
  ] as Node[],
  edges: [
    e("a1", "app", "run"),
    e("a2", "run", "loop"),
    e("a3", "loop", "model"),
    e("a4", "loop", "mem"),
    e("a5", "loop", "tool"),
    e("a6", "loop", "stop"),
    e("a7", "loop", "hook"),
    e("a8", "fake", "model", "implements", true),
    e("a9", "inmem", "mem", "implements", true),
    e("a10", "oai", "model", "implements", true),
    e("a11", "dur", "mem", "implements", true),
  ] as Edge[],
};

// --- view: composition over inheritance ------------------------------------
const composition = {
  nodes: [
    n("impl1", "{ stream } : ModelClient", -20, 40, "seam", 200),
    n("impl2", "{ load, append, clear } : Memory", -20, 150, "seam", 220),
    n("sc", "StopCondition", -20, 270, "seam", 200),
    n("dec1", "withModelObserver", 260, 40, "core", 180),
    n("dec2", "withMemoryNamespace", 260, 150, "core", 180),
    n("cmb", "any / all / not", 260, 270, "core", 180),
    n("tools", "Tool[]", 260, 360, "seam", 180),
    n("opt", "RunAgentOptions", 540, 170, "api", 180),
    n("run2", "runAgent()", 780, 170, "api", 160),
  ] as Node[],
  edges: [
    e("c1", "impl1", "dec1", "wrap"),
    e("c2", "impl2", "dec2", "wrap"),
    e("c3", "sc", "cmb", "combine"),
    e("c4", "dec1", "opt", "inject"),
    e("c5", "dec2", "opt", "inject"),
    e("c6", "cmb", "opt", "inject"),
    e("c7", "tools", "opt", "inject"),
    e("c8", "opt", "run2"),
  ] as Edge[],
};

// --- view: runtime flow -----------------------------------------------------
const flow = {
  nodes: [
    n("p", "prompt", 0, 80, "consumer", 120),
    n("load", "memory.load", 160, 80, "core", 140),
    n("stream", "stream assistant\n(ModelClient)", 340, 80, "core", 160),
    n("dec", "tool calls?", 560, 80, "api", 130),
    n("tools", "run Tools\n(parallel / sequential)", 560, 200, "seam", 180),
    n("append", "append results\nto Memory", 340, 200, "core", 160),
    n("stopq", "stop?\nterminate / stopWhen / maxSteps", 340, 320, "seam", 220),
    n("final", "final answer", 760, 80, "api", 140),
  ] as Node[],
  edges: [
    e("f1", "p", "load"),
    e("f2", "load", "stream"),
    e("f3", "stream", "dec"),
    e("f4", "dec", "final", "no tool calls"),
    e("f5", "dec", "tools", "tool calls"),
    e("f6", "tools", "append"),
    e("f7", "append", "stopq"),
    e("f8", "stopq", "stream", "no"),
    e("f9", "stopq", "final", "yes"),
  ] as Edge[],
};

const views: Record<ViewKey, { nodes: Node[]; edges: Edge[] }> = {
  architecture,
  composition,
  flow,
};

const nodes = computed(() => views[view.value].nodes);
const edges = computed(() => views[view.value].edges);
</script>

<template>
  <div class="arch">
    <div class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ active: view === t.key }"
        @click="view = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <div class="canvas">
      <ClientOnly>
        <VueFlow
          :key="view"
          :nodes="nodes"
          :edges="edges"
          :fit-view-on-init="true"
          :min-zoom="0.4"
          :max-zoom="1.6"
          :nodes-draggable="true"
          :nodes-connectable="false"
          :elements-selectable="true"
        />
      </ClientOnly>
    </div>

    <p class="hint">Drag nodes to explore · scroll to zoom · drag the canvas to pan</p>
  </div>
</template>

<style scoped>
.arch {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.tab {
  padding: 6px 14px;
  border: 1px solid #30363d;
  border-radius: 8px;
  background: #161b22;
  color: #8b949e;
  font-size: 13px;
  cursor: pointer;
}
.tab.active {
  background: #21262d;
  color: #e6edf3;
  border-color: #6e7681;
}
.canvas {
  height: 70vh;
  min-height: 420px;
  border: 1px solid #30363d;
  border-radius: 12px;
  overflow: hidden;
  background:
    radial-gradient(circle at 1px 1px, #21262d 1px, transparent 0) 0 0 / 22px 22px,
    #0d1117;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: #6e7681;
}
/* Keep multi-line node labels readable. */
:deep(.vue-flow__node) {
  white-space: pre-line;
  line-height: 1.25;
}
</style>
