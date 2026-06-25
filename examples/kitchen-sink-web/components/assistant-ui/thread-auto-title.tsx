"use client";

import { useAuiState, useThreadListItemRuntime } from "@assistant-ui/react";
import { useEffect, useRef, type FC } from "react";

/**
 * Auto-titles the active thread from its first user message.
 *
 * `useAssistantTransportRuntime` hardcodes an `InMemoryThreadListAdapter`, so
 * every thread renders the "New Chat" fallback. We can't swap that adapter (the
 * transport's thread-runtime hook isn't exported), but we don't need to:
 * `ThreadListItemRuntime.rename(title)` applies an *optimistic* local title, and
 * the in-memory adapter's `rename` is a no-op that resolves — so the title sticks
 * and the sidebar repaints, no runtime surgery required.
 *
 * Render this once inside the runtime provider. It paints nothing; it watches the
 * active thread and fires `rename` exactly once, as soon as the thread has a user
 * message and has been initialized (`status !== "new"`, or `rename` would throw).
 *
 * This is a Layer-C (UI-library) concern — it touches no bridge or agent code.
 * Title quality is intentionally cheap (a cleaned slice of the first message); to
 * upgrade to an LLM-generated title, replace `deriveTitle` with a call to a
 * titling endpoint after the first assistant turn completes.
 */

const MAX_TITLE_LEN = 48;

/** A short, single-line title from free-form user text, cut at a word boundary. */
function deriveTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= MAX_TITLE_LEN) return cleaned;
  const slice = cleaned.slice(0, MAX_TITLE_LEN);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > MAX_TITLE_LEN * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd() + "…";
}

type MessageLike = { role: string; content?: readonly { type: string; text?: string }[] };

/** Text of the first user message in the thread (empty if none / no text parts). */
function firstUserMessageText(messages: readonly MessageLike[]): string {
  const msg = messages.find((m) => m.role === "user");
  if (!msg) return "";
  return (msg.content ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join(" ")
    .trim();
}

export const ThreadAutoTitle: FC = () => {
  const runtime = useThreadListItemRuntime();
  const id = useAuiState((s) => s.threadListItem.id);
  const title = useAuiState((s) => s.threadListItem.title);
  const status = useAuiState((s) => s.threadListItem.status);
  const firstUserText = useAuiState((s) => firstUserMessageText(s.thread.messages));

  // Guard against re-firing while the optimistic title propagates. Keyed by
  // thread id so switching threads re-arms the titler for the new thread.
  const titledId = useRef<string | null>(null);

  useEffect(() => {
    if (!firstUserText) return; // nothing to name it after yet
    if (title) return; // already named — by us, or renamed by the user
    if (status === "new") return; // not initialized; rename() would throw
    if (titledId.current === id) return; // already attempted for this thread
    titledId.current = id;
    void runtime.rename(deriveTitle(firstUserText));
  }, [id, title, status, firstUserText, runtime]);

  return null;
};
