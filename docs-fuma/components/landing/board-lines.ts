/**
 * Fold a `DemoEvent` stream into renderable transcript lines — the shared
 * formatter behind both the hero's arrivals board and the "bring your own front
 * end" CLI panel, so the same run reads identically wherever it's rendered.
 * Consecutive `text_delta`s merge into one growing answer line (a real renderer
 * streams tokens into place rather than printing each chunk on its own row).
 */

import type { DemoEvent } from "./loop-script";

export type LineKind = "start" | "turn" | "reasoning" | "tool-call" | "tool-result" | "answer" | "done";
export type Line = { kind: LineKind; text: string };

export function applyEvent(lines: Line[], e: DemoEvent): Line[] {
  switch (e.type) {
    case "agent_start":
      return [{ kind: "start", text: `▶ start · session ${e.sessionId}` }];
    case "turn_start":
      return [...lines, { kind: "turn", text: `— turn ${e.step} —` }];
    case "reasoning_delta":
      return [...lines, { kind: "reasoning", text: e.text }];
    case "tool_start":
      return [...lines, { kind: "tool-call", text: `→ ${e.toolName}(${JSON.stringify(e.args)})` }];
    case "tool_end":
      return [...lines, { kind: "tool-result", text: `← ${e.toolName} [${e.isError ? "error" : "ok"}]: ${e.result}` }];
    case "text_delta": {
      const last = lines[lines.length - 1];
      if (last && last.kind === "answer")
        return [...lines.slice(0, -1), { kind: "answer", text: last.text + e.text }];
      return [...lines, { kind: "answer", text: e.text }];
    }
    case "agent_end":
      return [...lines, { kind: "done", text: `■ done · ${e.steps} steps` }];
  }
}

/** Fold a full (or partial) list of events into transcript lines. */
export function foldEvents(events: DemoEvent[]): Line[] {
  return events.reduce<Line[]>(applyEvent, []);
}

/** Tailwind classes per line kind — shared so every renderer colors alike. */
export const LINE_CLASS: Record<LineKind, string> = {
  start: "text-fd-muted-foreground",
  turn: "text-fd-primary/80",
  reasoning: "italic text-fd-muted-foreground/80",
  "tool-call": "text-[#22c55e]",
  "tool-result": "text-[#22c55e]/75",
  answer: "text-fd-foreground",
  done: "text-fd-muted-foreground",
};
