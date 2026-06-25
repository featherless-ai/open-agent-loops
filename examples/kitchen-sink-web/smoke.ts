/**
 * Browser-free smoke check for the kitchen-sink assistant.
 *
 * Drives the assistant + SSE bridge in-process with the mock model (no API key),
 * reads the streamed snapshots, and asserts the run completed with tool activity.
 * Exits non-zero on failure so it can gate CI.
 *
 *   bun run examples/kitchen-sink-web/smoke.ts
 */
import { createAssistant } from "./lib/agent";
import { runAgentSSE } from "./lib/bridge/sse-stream";
import type { AgentSnapshot } from "./lib/bridge/agent-snapshot";

const assistant = createAssistant({ mock: true });
const res = runAgentSSE({ run: assistant.runConfigFor("say hi and check the env", "smoke") });

const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buf = "";
let frames = 0;
let sawTool = false; // tool activity lives in intermediate frames (current resets per turn)
let snap: AgentSnapshot | undefined;
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const parts = buf.split("\n\n");
  buf = parts.pop() ?? "";
  for (const p of parts) {
    const line = p.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    frames++;
    snap = JSON.parse(line.slice(6)) as AgentSnapshot;
    if (snap.current.toolCalls.some((t) => t.status === "complete")) sawTool = true;
  }
}

if (!snap) throw new Error("no snapshot frames received");
const ok = snap.status === "done" && snap.steps >= 2 && snap.current.text.length > 0 && sawTool;

console.log(`frames=${frames} status=${snap.status} steps=${snap.steps} sawTool=${sawTool}`);
console.log(`final: ${JSON.stringify(snap.current.text)}`);
console.log(ok ? "PASS ✅" : "FAIL ❌");
if (!ok) process.exit(1);
