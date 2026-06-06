<script setup lang="ts">
/** Live demo — streams a response from a Featherless (OpenAI-compatible) model. */
useHead({ title: "agent-core — demo" });

type Msg = { role: "user" | "assistant"; content: string };

const { data: appConfig } = await useFetch<{ defaultModel: string }>("/api/config");
const messages = ref<Msg[]>([]);
const input = ref("");
const sending = ref(false);

async function send() {
  const text = input.value.trim();
  if (!text || sending.value) return;

  messages.value.push({ role: "user", content: text });
  input.value = "";
  sending.value = true;

  const assistantIdx = messages.value.length;
  messages.value.push({ role: "assistant", content: "" });

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      messages.value[assistantIdx]!.content += decoder.decode(value, { stream: true });
    }
  } catch (e) {
    messages.value[assistantIdx]!.content = `Error: ${(e as Error).message}`;
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <section class="max-w-3xl mx-auto px-6 py-8">
    <div class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight">Live demo</h1>
      <p class="text-sm text-white/50 font-mono">{{ appConfig?.defaultModel }}</p>
      <p class="text-sm text-white/50 mt-1">
        A minimal streaming chat against a Featherless model — the same
        OpenAI-compatible boundary <code>ModelClient</code> abstracts.
      </p>
    </div>

    <div class="space-y-4">
      <div v-if="messages.length === 0" class="text-center py-16">
        <p class="text-3xl mb-3 tracking-tight">
          <span class="text-[#FEF47A]">Hello,</span> world.
        </p>
        <p class="text-sm text-white/50">Type a message below to stream a response.</p>
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
            {{ m.content || (sending && i === messages.length - 1 ? "…" : "") }}
          </p>
        </div>
      </div>

      <form class="flex gap-2 pt-4" @submit.prevent="send">
        <UInput
          v-model="input"
          placeholder="Ask something..."
          class="flex-1"
          :disabled="sending"
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
    </div>
  </section>
</template>
