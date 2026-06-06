<script setup lang="ts">
/** Documentation home — overview of the agent-core SDK. */
useHead({ title: "agent-core — lightweight composable agent SDK" });

const quickstart = `import { runAgent, InMemoryStore, FakeModelClient, defineTool } from "~/agent-core";
import { z } from "zod";

const weather = defineTool({
  name: "weather",
  description: "Get weather for a city",
  parameters: z.object({ city: z.string() }),
  execute: ({ city }) => ({ content: \`Sunny in \${city}\` }),
});

// Swap FakeModelClient for any OpenAI-compatible client in production.
const model = new FakeModelClient([
  { toolCalls: [{ name: "weather", arguments: { city: "Paris" } }] },
  { text: "It's sunny in Paris." },
]);

const { messages } = await runAgent({
  model,
  memory: new InMemoryStore(),
  sessionId: "demo",
  prompt: "What's the weather in Paris?",
  tools: [weather],
});`;

const inlineSeam = `// A seam is just an object/function that satisfies an interface.
// No base class, no factory.
const model: ModelClient = { stream: (req) => myStream(req) };
const memory: Memory = { load, append, clear };

// Add behavior by wrapping (decorator), not subclassing:
const observed = withModelObserver(model, (e) => log(e));
const scoped   = withMemoryNamespace(memory, "tenantA");`;

const seams = [
  { seam: "ModelClient", role: "LLM boundary (streams by default)", builtin: "FakeModelClient" },
  { seam: "Memory", role: "Conversation storage", builtin: "InMemoryStore" },
  { seam: "Tool", role: "A callable capability", builtin: "defineTool()" },
  { seam: "StopCondition", role: "When a run ends", builtin: "maxSteps / whenToolCalled" },
  { seam: "Hooks", role: "Guardrails & context shaping", builtin: "before/after, transformContext" },
];
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="max-w-6xl mx-auto px-6 pt-16 pb-10">
      <p class="text-xs font-mono text-[#FEF47A] mb-3">lightweight agent SDK</p>
      <h1 class="text-4xl sm:text-5xl font-semibold tracking-tight max-w-3xl">
        A tiny, <span class="text-[#FEF47A]">composable</span> agentic loop.
      </h1>
      <p class="mt-4 text-white/60 max-w-2xl">
        One thin core engine that depends only on small, swappable interfaces —
        model, memory, tools, stop conditions, hooks. Streams by default.
        Composition over inheritance, end to end.
      </p>
      <div class="mt-6 flex flex-wrap gap-3">
        <UButton to="/architecture" class="bg-[#FEF47A] text-[#141413] hover:bg-[#fdec4d]">
          Explore the architecture
        </UButton>
        <UButton to="/demo" variant="outline" color="neutral">Try the live demo</UButton>
      </div>
    </section>

    <!-- Seams -->
    <section class="max-w-6xl mx-auto px-6 py-8">
      <h2 class="text-lg font-semibold tracking-tight mb-4">The seams</h2>
      <div class="overflow-x-auto rounded-xl border border-white/10">
        <table class="w-full text-sm">
          <thead class="bg-white/[0.03] text-white/50">
            <tr>
              <th class="text-left font-medium px-4 py-3">Interface</th>
              <th class="text-left font-medium px-4 py-3">Responsibility</th>
              <th class="text-left font-medium px-4 py-3">Built-in (v1)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in seams" :key="s.seam" class="border-t border-white/10">
              <td class="px-4 py-3 font-mono text-[#FEF47A]">{{ s.seam }}</td>
              <td class="px-4 py-3 text-white/80">{{ s.role }}</td>
              <td class="px-4 py-3 font-mono text-white/60">{{ s.builtin }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Quickstart + composition -->
    <section class="max-w-6xl mx-auto px-6 py-8 grid md:grid-cols-2 gap-8">
      <div>
        <h2 class="text-lg font-semibold tracking-tight mb-3">Quickstart</h2>
        <p class="text-white/60 text-sm mb-4">
          Wire a model, memory, and a tool, then run the loop. The model streams,
          tools run (parallel or sequential), results persist to memory, and the
          loop stops on the final answer.
        </p>
        <pre class="rounded-xl border border-white/10 bg-black/40 p-4 overflow-x-auto text-[12.5px] leading-relaxed"><code>{{ quickstart }}</code></pre>
      </div>
      <div>
        <h2 class="text-lg font-semibold tracking-tight mb-3">Composition over inheritance</h2>
        <p class="text-white/60 text-sm mb-4">
          No <code class="text-[#FEF47A]">extends</code>, no base classes. Implement
          an interface inline; add behavior by wrapping; combine predicates. The
          core never changes when you add a provider or store.
        </p>
        <pre class="rounded-xl border border-white/10 bg-black/40 p-4 overflow-x-auto text-[12.5px] leading-relaxed"><code>{{ inlineSeam }}</code></pre>
      </div>
    </section>
  </div>
</template>
