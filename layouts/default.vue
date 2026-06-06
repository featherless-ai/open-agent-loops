<script setup lang="ts">
/** Shared documentation shell: top nav + content slot + footer. */
const route = useRoute();
const links = [
  { to: "/", label: "Overview" },
  { to: "/architecture", label: "Architecture" },
  { to: "/demo", label: "Demo" },
];
const isActive = (to: string) =>
  to === "/" ? route.path === "/" : route.path.startsWith(to);
</script>

<template>
  <div class="min-h-screen bg-[#141413] text-white flex flex-col">
    <header class="sticky top-0 z-10 border-b border-white/10 bg-[#141413]/90 backdrop-blur">
      <div class="max-w-6xl mx-auto px-6 h-14 flex items-center gap-6">
        <NuxtLink to="/" class="flex items-center gap-2 font-semibold tracking-tight">
          <span class="inline-block w-6 h-6 rounded bg-[#FEF47A]" />
          agent-core
        </NuxtLink>
        <nav class="flex items-center gap-1 text-sm">
          <NuxtLink
            v-for="l in links"
            :key="l.to"
            :to="l.to"
            class="px-3 py-1.5 rounded-md transition-colors"
            :class="isActive(l.to)
              ? 'text-white bg-white/10'
              : 'text-white/60 hover:text-white hover:bg-white/5'"
          >
            {{ l.label }}
          </NuxtLink>
        </nav>
        <div class="ml-auto">
          <UButton
            to="https://github.com/ArEnSc/advance-agent"
            target="_blank"
            variant="ghost"
            size="sm"
            icon="i-lucide-github"
          >
            GitHub
          </UButton>
        </div>
      </div>
    </header>

    <main class="flex-1">
      <slot />
    </main>

    <footer class="border-t border-white/10">
      <div class="max-w-6xl mx-auto px-6 py-6 text-xs text-white/40">
        agent-core — a lightweight, composable agent SDK.
      </div>
    </footer>
  </div>
</template>
