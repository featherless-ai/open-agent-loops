<script setup lang="ts">
type Msg = { role: 'user' | 'assistant'; content: string };

// Pulls the model name (and any future public config) from /api/config so the
// server reads it from process.env at request time — no Nuxt runtimeConfig +
// no NUXT_* env-var bridge needed for new vars.
const { data: appConfig } = await useFetch<{ defaultModel: string }>('/api/config');
const messages = ref<Msg[]>([]);
const input = ref('');
const sending = ref(false);

async function send() {
  const text = input.value.trim();
  if (!text || sending.value) return;

  messages.value.push({ role: 'user', content: text });
  input.value = '';
  sending.value = true;

  const assistantIdx = messages.value.length;
  messages.value.push({ role: 'assistant', content: '' });

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.value.slice(0, -1) }),
    });
    if (!res.ok || !res.body) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(err || `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      messages.value[assistantIdx].content += decoder.decode(value, { stream: true });
    }
  } catch (e) {
    messages.value[assistantIdx].content = `Error: ${(e as Error).message}`;
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-[#141413] text-white">
    <header class="border-b border-white/10">
      <div class="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
        <img src="/featherless-logo.svg" alt="Featherless" class="w-9 h-9 rounded-lg" />
        <div>
          <h1 class="text-lg font-semibold tracking-tight">Featherless Nuxt Starter</h1>
          <p class="text-xs text-white/50 font-mono">{{ appConfig?.defaultModel }}</p>
        </div>
      </div>
    </header>

    <main class="max-w-3xl mx-auto px-6 py-8 space-y-4">
      <div v-if="messages.length === 0" class="text-center py-16">
        <p class="text-3xl mb-3 tracking-tight">
          <span class="text-[#FEF47A]">Hello,</span> world.
        </p>
        <p class="text-sm text-white/50">Type a message below to stream a response from Featherless.</p>
      </div>

      <div
        v-for="(m, i) in messages"
        :key="i"
        class="flex"
        :class="m.role === 'user' ? 'justify-end' : 'justify-start'"
      >
        <div
          class="max-w-[80%] rounded-2xl px-4 py-2"
          :class="m.role === 'user'
            ? 'bg-[#FEF47A] text-[#141413] font-medium'
            : 'bg-white/[0.04] border border-white/10 text-white/90'"
        >
          <p class="whitespace-pre-wrap text-sm">
            {{ m.content || (sending && i === messages.length - 1 ? '…' : '') }}
          </p>
        </div>
      </div>

      <form class="flex gap-2 pt-4" @submit.prevent="send">
        <UInput
          v-model="input"
          placeholder="Ask something..."
          class="flex-1"
          :disabled="sending"
          :ui="{ base: 'bg-white/[0.04] border border-white/10 text-white placeholder:text-white/40 focus:ring-[#FEF47A]' }"
        />
        <UButton
          type="submit"
          :loading="sending"
          :disabled="!input.trim()"
          class="bg-[#FEF47A] text-[#141413] hover:bg-[#fdec4d] disabled:opacity-50"
        >
          Send
        </UButton>
      </form>
    </main>
  </div>
</template>
