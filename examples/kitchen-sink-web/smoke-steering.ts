/**
 * Browser-free smoke check for the steering + follow-up pull-seams.
 *
 * Drives the kitchen-sink assistant in-process with the mock model (no API key)
 * and exercises both drain seams through the public `steer()` / `followUp()` API:
 *
 *   - steering  → drained after a turn's tools, injected mid-run
 *                 (a `message_injected` event with origin "steering")
 *   - follow-up → drained when the run would otherwise end, continuing it in
 *                 place (a `message_injected` event with origin "follow_up")
 *
 * Asserts each queued message actually reached the loop and was injected, then
 * exits non-zero on failure so it can gate CI.
 *
 *   deno run -A examples/kitchen-sink-web/smoke-steering.ts
 *   bun run examples/kitchen-sink-web/smoke-steering.ts
 */
import { AgentEventType, runAgent } from "@open-agent-loops/core";
import type { AgentEvent, Message } from "@open-agent-loops/core";
import { createAssistant } from "./lib/agent";

const assistant = createAssistant({ mock: true });

const textOf = (message: Message): string =>
  typeof message.content === "string" ? message.content : JSON.stringify(message.content);

const injectedOf = (events: AgentEvent[], origin: string) =>
  events.filter(
    (e): e is Extract<AgentEvent, { type: AgentEventType.MessageInjected }> =>
      e.type === AgentEventType.MessageInjected && e.origin === origin,
  );

async function runCollecting(prompt: string, sessionId: string) {
  const events: AgentEvent[] = [];
  const result = await runAgent({
    ...assistant.runConfigFor(prompt, sessionId),
    onEvent: (e) => {
      events.push(e);
    },
  });
  return { events, steps: result.steps };
}

// ── Steering: queued for an in-flight run; the loop drains it after the turn's
//    tool results and injects it, redirecting the run. ─────────────────────────
const steerText = "Actually, also confirm the working directory is clean.";
assistant.steer("smoke-steer", steerText);
const steer = await runCollecting("check the env", "smoke-steer");
const steerInjected = injectedOf(steer.events, "steering");
const steerOk =
  steerInjected.length === 1 && textOf(steerInjected[0]!.message) === steerText && steer.steps >= 2;

// ── Follow-up: queued for a session; drained only when the run reaches a
//    natural final answer, continuing it in place (one extra turn). ────────────
const fuText = "And summarize what you found.";
assistant.followUp("smoke-followup", fuText);
const fu = await runCollecting("say hi and check the env", "smoke-followup");
const fuInjected = injectedOf(fu.events, "follow_up");
const fuOk =
  fuInjected.length === 1 && textOf(fuInjected[0]!.message) === fuText && fu.steps >= 3;

console.log(`steering : injected=${steerInjected.length} steps=${steer.steps} -> ${steerOk ? "PASS" : "FAIL"}`);
console.log(`follow-up: injected=${fuInjected.length} steps=${fu.steps} -> ${fuOk ? "PASS" : "FAIL"}`);

const ok = steerOk && fuOk;
console.log(ok ? "PASS ✅" : "FAIL ❌");
if (!ok) process.exit(1);
