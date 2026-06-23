"use client";

/**
 * Scrollytelling seam tour — the loop as a line you ride top to bottom. A sticky
 * panel holds a vertical line of stations on the left and the matching config
 * snippet on the right; scrolling the tall outer section moves a glowing "train"
 * down the line, station by station, swapping the snippet as you go.
 *
 * Scroll position is read directly (rAF-throttled) and mapped to the active
 * stage — reliable across browsers — while anime.js handles the train glide and
 * the snippet fade. Reduced motion drops the sticky scrub and stacks every stage.
 */

import { useEffect, useRef, useState } from "react";
import { animate } from "animejs";
import { SEAM, type Seam } from "../seams";
import { useReducedMotion } from "./use-reduced-motion";

type Stage = { seam: Seam; label: string; sub: string; code: string; caption: string };

const STAGES: Stage[] = [
  {
    seam: "memory",
    label: "Memory",
    sub: "load history",
    code: "memory: new SessionMemoryStore()",
    caption: "Conversation history loads before the first turn.",
  },
  {
    seam: "model",
    label: "ModelClient",
    sub: "stream the turn",
    code: "model: new OpenAICompatibleModel({\n  baseURL, apiKey, model,\n})",
    caption: "The one seam that talks to an LLM — a single stream() method.",
  },
  {
    seam: "tool",
    label: "Tool",
    sub: "run tools",
    code: 'tools: [\n  defineTool({ name: "weather", parameters, execute }),\n]',
    caption: "Tool calls run in parallel; results fold back into the loop.",
  },
  {
    seam: "stop",
    label: "StopCondition",
    sub: "stop?",
    code: "stopWhen: maxSteps(10)",
    caption: "Stop on a final answer, a terminate flag, or your own predicate.",
  },
  {
    seam: "hook",
    label: "Hooks",
    sub: "extend",
    code: "hooks: {\n  gateToolCalls: permissionGate(store, prompter),\n}",
    caption: "Five optional hooks: gate tools, reshape context, steer mid-run.",
  },
];

const GAP = 68; // px between stations on the vertical line

function StationRow({ stage, active }: { stage: Stage; active: boolean }) {
  const color = SEAM[stage.seam];
  return (
    <div className="flex items-center gap-3" style={{ height: GAP }}>
      <span
        className="grid size-7 shrink-0 place-items-center rounded-full border-2 transition-transform"
        style={{
          borderColor: color,
          background: active ? color : "var(--color-fd-background)",
          transform: active ? "scale(1.15)" : "scale(1)",
        }}
      >
        <span
          className="size-2 rounded-full"
          style={{ background: active ? "var(--color-fd-background)" : color }}
        />
      </span>
      <div className="leading-tight">
        <div className="font-mono text-sm font-semibold" style={{ color, opacity: active ? 1 : 0.7 }}>
          {stage.label}
        </div>
        <div className="font-mono text-[11px] text-fd-muted-foreground">{stage.sub}</div>
      </div>
    </div>
  );
}

function Snippet({ stage }: { stage: Stage }) {
  return (
    <div className="flex flex-col gap-3">
      <pre className="overflow-x-auto rounded-lg border border-fd-border bg-fd-card p-4 font-mono text-sm text-fd-foreground">
        <code>{stage.code}</code>
      </pre>
      <p className="text-sm text-fd-muted-foreground">{stage.caption}</p>
    </div>
  );
}

export function SeamTour() {
  const reduced = useReducedMotion();
  const sectionRef = useRef<HTMLDivElement>(null);
  const trainRef = useRef<HTMLDivElement>(null);
  const snippetRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);

  // Move the train + fade the snippet whenever the active stage changes.
  useEffect(() => {
    if (reduced) return;
    if (trainRef.current) {
      animate(trainRef.current, { translateY: active * GAP, duration: 420, ease: "outQuad" });
    }
    if (snippetRef.current) {
      animate(snippetRef.current, { opacity: [0, 1], translateX: [8, 0], duration: 280, ease: "outQuad" });
    }
  }, [active, reduced]);

  // Map scroll position through the section to an active stage.
  useEffect(() => {
    if (reduced) return;
    const section = sectionRef.current;
    if (!section) return;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const rect = section.getBoundingClientRect();
        const vh = window.innerHeight;
        const scrollable = rect.height - vh;
        const progress = scrollable > 0 ? Math.min(1, Math.max(0, -rect.top / scrollable)) : 0;
        const idx = Math.min(STAGES.length - 1, Math.floor(progress * STAGES.length));
        if (idx !== activeRef.current) {
          activeRef.current = idx;
          setActive(idx);
        }
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  // Reduced motion: a calm, fully-expanded list — no sticky scrub.
  if (reduced) {
    return (
      <section className="mx-auto w-full max-w-6xl px-6 py-16">
        <TourHeading />
        <div className="flex flex-col gap-8">
          {STAGES.map((stage) => (
            <div key={stage.seam} className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-center">
              <StationRow stage={stage} active />
              <Snippet stage={stage} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section ref={sectionRef} className="relative mx-auto w-full max-w-6xl px-6" style={{ height: `${STAGES.length * 55}vh` }}>
      <div className="sticky top-0 flex min-h-screen flex-col justify-center py-16">
        <TourHeading />
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:items-center">
          {/* the line */}
          <div className="relative">
            <div className="absolute left-[13px] top-[34px] w-0.5 bg-fd-border" style={{ height: (STAGES.length - 1) * GAP }} />
            {/* the train glides along the line */}
            <div
              ref={trainRef}
              className="absolute left-[7px] top-[27px] size-3.5 rounded-full"
              style={{ background: "var(--color-fd-primary)", boxShadow: "0 0 8px var(--color-fd-primary)" }}
            />
            <div className="relative flex flex-col">
              {STAGES.map((stage, i) => (
                <StationRow key={stage.seam} stage={stage} active={i === active} />
              ))}
            </div>
          </div>
          {/* the active snippet */}
          <div ref={snippetRef}>
            <Snippet stage={STAGES[active]} />
          </div>
        </div>
      </div>
    </section>
  );
}

function TourHeading() {
  return (
    <div className="mb-10 flex flex-col gap-3">
      <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Ride the line</h2>
      <p className="max-w-2xl text-fd-muted-foreground">
        One pass through the loop, seam by seam — each is just a field on{" "}
        <code className="rounded bg-fd-muted px-1 py-0.5">runAgent()</code>. Scroll to ride along.
      </p>
    </div>
  );
}
