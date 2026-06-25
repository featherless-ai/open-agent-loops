"use client";

import {
  AssistantRuntimeProvider,
  Tools,
  type AssistantTransportConnectionMetadata,
  type ThreadMessageLike,
  unstable_createMessageConverter as createMessageConverter,
  useAui,
  useAssistantTransportRuntime,
} from "@assistant-ui/react";
import type { ReactNode } from "react";
import { ThreadAutoTitle } from "@/components/assistant-ui/thread-auto-title";
import toolkit from "./toolkit";

/**
 * The agent backend (app/api/assistant) shapes its streamed transport state as
 * `{ messages: ThreadMessageLike[] }` — the whole conversation incl. the in-flight
 * assistant turn (reasoning / tool calls / text parts). The transport runtime is
 * built on ExternalStore, which renders the *converted* `ThreadMessage` form, not
 * raw `ThreadMessageLike` — so we run them through a message converter (the map is
 * identity since the backend already emits ThreadMessageLike). All the agent→UI
 * mapping lives server-side in `lib/bridge/assistant-transport.ts`.
 */
type State = { messages: ThreadMessageLike[] };

const MessageConverter = createMessageConverter((m: ThreadMessageLike) => m);

const converter = (state: State, meta: AssistantTransportConnectionMetadata) => {
  const isRunning = meta.isSending ?? false;
  return {
    // Pass `isRunning` into the message conversion, not just the thread-level
    // flag below. `toThreadMessages` defaults its second arg to `false`, so the
    // in-flight assistant message would otherwise convert as "complete" and its
    // trailing part would never read "running" — the signal the reasoning / tool
    // shimmer keys off. With it, the last part shimmers while the agent streams it
    // and stops the moment a later part (text / tool) is appended after it.
    messages: MessageConverter.toThreadMessages(state?.messages ?? [], isRunning),
    isRunning,
  };
};

export function MyRuntimeProvider({ children }: { children: ReactNode }) {
  const runtime = useAssistantTransportRuntime({
    initialState: { messages: [] },
    api: process.env.NEXT_PUBLIC_API_URL || "/api/assistant",
    converter,
    headers: {},
  });
  const aui = useAui({ tools: Tools({ toolkit }) });

  return (
    <AssistantRuntimeProvider aui={aui} runtime={runtime}>
      <ThreadAutoTitle />
      {children}
    </AssistantRuntimeProvider>
  );
}
