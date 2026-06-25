/**
 * The agent backend: speaks assistant-ui's Assistant Transport protocol.
 *
 * The runtime POSTs `{ commands, state, system, tools, threadId }`. The new user
 * prompt arrives as an `add-message` command; the prior conversation arrives in
 * `state` (the runtime round-trips it). We run the kitchen-sink agent and stream
 * its evolving assistant message back as transport state (see
 * `lib/bridge/assistant-transport.ts`).
 *
 * Auto-approve permissions for v1 (the agent's gate logs + allows); the real
 * human-in-the-loop flow would surface `add-tool-result` commands instead.
 */
import { createAssistantStreamResponse } from "assistant-stream";
import type { ThreadMessageLike } from "@assistant-ui/react";
import { assistant } from "@/lib/assistant-instance";
import { runAgentToTransport } from "@/lib/bridge/assistant-transport";

// SSE-style stream; never statically cached.
export const dynamic = "force-dynamic";

interface AddMessageCommand {
  type: "add-message";
  message: { role: string; parts: { type: string; text?: string }[] };
  // Index signature so this narrows from the loose `{ type; [k]: unknown }[]`
  // command shape in the `.filter` type-predicate below (TS2677 otherwise).
  [k: string]: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    commands?: { type: string; [k: string]: unknown }[];
    state?: { messages?: ThreadMessageLike[] };
    threadId?: string | null;
  };

  const userText = (body.commands ?? [])
    .filter((c): c is AddMessageCommand => c.type === "add-message")
    .flatMap((c) => c.message?.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();

  const priorMessages = body.state?.messages ?? [];
  const sessionId = body.threadId || "web";

  return createAssistantStreamResponse(async (controller) => {
    await runAgentToTransport(controller, {
      // Forward the request's abort signal: on client disconnect/cancel the loop
      // stops calling the model AND kills in-flight tool subprocesses (the core
      // threads `signal` to every `tool.execute` ctx; node-backends pass it to
      // `spawn`). Without this the run completes server-side after the client left.
      run: { ...assistant.runConfigFor(userText, sessionId), signal: req.signal },
      priorMessages,
      userText,
    });
  });
}
