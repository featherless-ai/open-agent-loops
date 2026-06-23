"use client";

/**
 * "Bring your own front end" — the loop is headless: it emits one typed
 * AgentEvent stream and you decide how to present it. A trace is just data, so
 * the *same* scripted run is scrubbable here: drag the slider (or press play) and
 * three renderers rebuild in lockstep off one clock — a CLI/stdout view, a DOM
 * timeline, and the raw JSONL wire. Same events, three front ends, zero changes
 * to the loop. (Folds the old standalone "trace replay" in: render-anywhere and
 * inspect-the-trace are one story, shown once.)
 */

import { useEffect, useRef, useState } from "react";
import { SEAM } from "../seams";
import { LOOP_SCRIPT, type DemoEvent, type Station } from "./loop-script";
import { foldEvents, LINE_CLASS } from "./board-lines";
import { useReducedMotion } from "./use-reduced-motion";

const N = LOOP_SCRIPT.length;

// Which seam each event "belongs" to, for the DOM timeline's color dots.
function eventSeam(e: DemoEvent): Station {
  switch (e.type) {
    case "agent_start":
    case "turn_start":
      return "memory";
    case "reasoning_delta":
    case "text_delta":
      return "model";
    case "tool_start":
    case "tool_end":
      return "tool";
    case "agent_end":
      return "stop";
  }
}

function eventSummary(e: DemoEvent): string {
  switch (e.type) {
    case "agent_start":
      return `session ${e.sessionId}`;
    case "turn_start":
      return `turn ${e.step}`;
    case "reasoning_delta":
      return "reasoning…";
    case "text_delta":
      return `"${e.text.trim()}"`;
    case "tool_start":
      return `${e.toolName}(${JSON.stringify(e.args)})`;
    case "tool_end":
      return `${e.toolName} → ${e.result}`;
    case "agent_end":
      return `${e.steps} steps`;
  }
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[260px] flex-col rounded-xl border border-fd-border bg-fd-card">
      <div className="border-b border-fd-border px-3 py-2 font-mono text-xs text-fd-muted-foreground">{title}</div>
      <div className="flex-1 overflow-hidden p-3 font-mono text-xs leading-relaxed">{children}</div>
    </div>
  );
}

export function ByoFrontend() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(N);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!playing) return;
    if (step >= N) {
      setPlaying(false);
      return;
    }
    const hold = LOOP_SCRIPT[step]?.holdMs ?? 600;
    timer.current = setTimeout(() => setStep((s) => Math.min(N, s + 1)), Math.min(hold, 900));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [playing, step]);

  function togglePlay() {
    if (step >= N) setStep(0); // replay from the top
    setPlaying((p) => !p);
  }

  const shown = reduced ? N : step;
  const events = LOOP_SCRIPT.slice(0, shown).map((s) => s.event);
  const lines = foldEvents(events);

  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-16">
      <div className="mb-8 flex flex-col gap-3 text-center">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Bring your own front end</h2>
        <p className="mx-auto max-w-2xl text-fd-muted-foreground">
          The loop never writes to a screen — it emits one typed{" "}
          <code className="rounded bg-fd-muted px-1 py-0.5">AgentEvent</code> stream, so a trace is
          just data. Scrub the same run and watch three front ends rebuild in lockstep.
        </p>
      </div>

      {/* one clock for all three renderers: scrub or play */}
      {!reduced && (
        <div className="mx-auto mb-6 flex max-w-2xl items-center gap-4 rounded-xl border border-fd-border bg-fd-card px-4 py-3">
          <button
            type="button"
            onClick={togglePlay}
            className="shrink-0 rounded-md bg-fd-primary px-3 py-1.5 text-sm font-semibold text-fd-primary-foreground"
          >
            {playing ? "❚❚ pause" : step >= N ? "↻ replay" : "▶ play"}
          </button>
          <input
            type="range"
            min={0}
            max={N}
            value={step}
            onChange={(e) => {
              setPlaying(false);
              setStep(Number(e.target.value));
            }}
            className="h-1 flex-1 cursor-pointer accent-fd-primary"
            aria-label="Scrub the trace"
          />
          <span className="w-14 shrink-0 text-right font-mono text-xs text-fd-muted-foreground">
            {shown}/{N}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* CLI / stdout */}
        <Panel title="› CLI · stdout">
          <div className="flex flex-col gap-1">
            {lines.map((line, i) => (
              <div key={i} className={`${LINE_CLASS[line.kind]} whitespace-pre-wrap break-words`}>
                {line.text}
              </div>
            ))}
          </div>
        </Panel>

        {/* DOM timeline */}
        <Panel title="◴ DOM · timeline">
          <ol className="flex flex-col gap-1.5">
            {events.map((e, i) => (
              <li key={i} className="flex items-center gap-2 rounded-md border border-fd-border/60 px-2 py-1">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: SEAM[eventSeam(e)] }} />
                <span className="shrink-0 text-fd-muted-foreground">{e.type}</span>
                <span className="truncate text-fd-foreground">{eventSummary(e)}</span>
              </li>
            ))}
          </ol>
        </Panel>

        {/* Raw JSONL */}
        <Panel title="{} raw · JSONL">
          <div className="flex flex-col gap-1">
            {events.map((e, i) => (
              <div key={i} className="whitespace-pre-wrap break-all text-fd-muted-foreground">
                {JSON.stringify(e)}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </section>
  );
}
