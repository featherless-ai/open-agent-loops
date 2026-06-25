/**
 * Mount the runtime and render a minimal thread from assistant-ui's HEADLESS
 * primitives.
 *
 * Pinned @assistant-ui/react@0.14.x (June 2026). 0.14 is *headless* — there is no
 * styled `<Thread/>` or bundled CSS in this package (those are the separate
 * `@assistant-ui/react-ui` line / the shadcn registry; see
 * references/assistant-ui.md → "Styling"). Composing the primitives needs no extra
 * dependency and is guaranteed to match the installed runtime. Verify the members
 * against current docs: https://www.assistant-ui.com/docs
 */
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
} from "@assistant-ui/react";
import { agentAdapter } from "./agent-adapter";

// One renderer for both roles; MessagePrimitive.Parts renders the message's
// content parts (our adapter yields text). Add styling (a CSS file, or the
// styled opt-in in references/assistant-ui.md) to taste.
function Message() {
  return (
    <MessagePrimitive.Root style={{ padding: "8px 0", whiteSpace: "pre-wrap" }}>
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

export default function App() {
  const runtime = useLocalRuntime(agentAdapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root
        style={{ display: "flex", flexDirection: "column", height: "100dvh", maxWidth: 720, margin: "0 auto" }}
      >
        <ThreadPrimitive.Viewport style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <ThreadPrimitive.Messages components={{ UserMessage: Message, AssistantMessage: Message }} />
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root style={{ display: "flex", gap: 8, padding: 16, borderTop: "1px solid #e5e5e5" }}>
          <ComposerPrimitive.Input style={{ flex: 1, padding: 8 }} placeholder="Message the agent…" />
          <ComposerPrimitive.Send style={{ padding: "8px 16px" }}>Send</ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
