/**
 * Inject a message into a session's IN-FLIGHT run.
 *
 * The chat route (`/api/assistant`) starts a run; while it's still working — mid
 * tool call, mid reasoning — POST here to push a message into that session's
 * steering or follow-up queue. The loop pulls it at its next boundary (see
 * `hooks.drainSteering` / `hooks.drainFollowUp` in `lib/agent.ts`):
 *
 *   - `kind: "steering"` (default) — drained after the next turn's tool results,
 *     redirecting the run even past a tool's `terminate` or a `stopWhen`.
 *   - `kind: "follow-up"` — drained only when the run would otherwise stop at a
 *     natural final answer, continuing it in place (one trace).
 *
 *   curl -s -X POST http://localhost:3000/api/assistant/steer \
 *     -H 'content-type: application/json' \
 *     -d '{"threadId":"ID","text":"actually, also check the README","kind":"steering"}'
 *
 * Both queues are keyed by sessionId on the shared assistant singleton, so this
 * reaches the run the chat route started for the same thread.
 */
import { assistant } from "@/lib/assistant-instance";

export const dynamic = "force-dynamic";

interface SteerBody {
  threadId?: string | null;
  text?: string;
  kind?: "steering" | "follow-up";
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as SteerBody;
  const text = body.text?.trim();
  if (!text) {
    return Response.json({ error: "`text` is required" }, { status: 400 });
  }

  const sessionId = body.threadId || "web";
  const kind = body.kind === "follow-up" ? "follow-up" : "steering";
  if (kind === "follow-up") assistant.followUp(sessionId, text);
  else assistant.steer(sessionId, text);

  return Response.json({ ok: true, sessionId, kind });
}
