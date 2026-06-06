<script setup lang="ts">
/** Architecture docs — interactive node-based diagrams (Vue Flow). */
useHead({ title: "agent-core — architecture" });
</script>

<template>
  <section class="max-w-6xl mx-auto px-6 py-8">
    <h1 class="text-2xl font-semibold tracking-tight">Architecture</h1>
    <p class="mt-2 text-white/60 max-w-2xl text-sm">
      The core engine (<code class="text-[#FEF47A]">runAgent</code>) depends only
      on interfaces. Built-ins satisfy them today; new providers/stores are
      sibling implementations of the same seams. Switch views below and drag the
      nodes to explore.
    </p>

    <div class="mt-6">
      <ArchitectureFlow />
    </div>
  </section>
</template>
