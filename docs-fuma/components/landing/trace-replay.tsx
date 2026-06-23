"use client";

/**
 * Trace replay — the glass box. A captured run is just data, so you can scrub it:
 * drag the slider to any point, or hit play to watch the trajectory rebuild
 * event by event. Same `LOOP_SCRIPT` as the hero, here under manual control —
 * the payoff of a headless loop that emits a typed, inspectable stream.
 */

import { useEffect, useRef, useState } from "react";
import { SEAM } from "../seams";
import { LOOP_SCRIPT, type DemoEvent, type Station } from "./loop-script";

const N = LOOP_SCRIPT.length;

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

function detail(e: DemoEvent): string {
  switch (e.type) {
    case "agent_start":
      return `session "${e.sessionId}"`;
    case "turn_start":
      return `step ${e.step}`;
    case "reasoning_delta":
      return e.text;
    case "text_delta":
      return `"${e.text}"`;
    case "tool_start":
      return `${e.toolName}(${JSON.stringify(e.args)})`;
    case "tool_end":
      return `${e.toolName} → ${e.result}${e.isError ? " (error)" : ""}`;
    case "agent_end":
      return `${e.steps} steps total`;
  }
}

export function TraceReplay() {
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

  const events = LOOP_SCRIPT.slice(0, step);

  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-16">
      <div className="mb-8 flex flex-col gap-3 text-center">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">A glass box, not a black box</h2>
        <p className="mx-auto max-w-2xl text-fd-muted-foreground">
          Every run is a typed event stream, so a trace is just data you can replay.
          Scrub it, or press play to rebuild the trajectory step by step.
        </p>
      </div>

      <div className="rounded-2xl border border-fd-border bg-fd-card">
        {/* controls */}
        <div className="flex items-center gap-4 border-b border-fd-border px-4 py-3">
          <button
            type="button"
            onClick={togglePlay}
            className="rounded-md bg-fd-primary px-3 py-1.5 text-sm font-semibold text-fd-primary-foreground"
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
            {step}/{N}
          </span>
        </div>

        {/* trajectory */}
        <ol className="flex max-h-[340px] flex-col gap-1.5 overflow-y-auto p-4 font-mono text-sm">
          {events.map((s, i) => {
            const e = s.event;
            const color = SEAM[eventSeam(e)];
            return (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="w-32 shrink-0 text-fd-muted-foreground">{e.type}</span>
                <span className="text-fd-foreground">{detail(e)}</span>
              </li>
            );
          })}
          {events.length === 0 && (
            <li className="text-fd-muted-foreground">— drag the slider or press play —</li>
          )}
        </ol>
      </div>
    </section>
  );
}
