/**
 * Layer C — mount the runtime and render assistant-ui's <Thread />.
 *
 * Pinned to @assistant-ui/react@0.14.x (verified June 2026). Verify the exports
 * (`AssistantRuntimeProvider`, `useLocalRuntime`, `Thread`) against current docs:
 *   https://www.assistant-ui.com/docs
 */
import { AssistantRuntimeProvider, useLocalRuntime, Thread } from "@assistant-ui/react";
// assistant-ui ships styles; import per the current docs (path may differ by
// version — check the "styling" page if the UI looks unstyled).
import "@assistant-ui/react/styles/index.css";
import { agentAdapter } from "./agent-adapter";

export default function App() {
  const runtime = useLocalRuntime(agentAdapter);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main style={{ height: "100dvh", maxWidth: 720, margin: "0 auto" }}>
        <Thread />
      </main>
    </AssistantRuntimeProvider>
  );
}
