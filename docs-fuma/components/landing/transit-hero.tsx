"use client";

/**
 * The signature animation: the agent loop drawn as a subway line. The line draws
 * itself, then a request "train" rides it and pulls into each seam-station
 * (Memory → ModelClient → Tool → StopCondition) while the arrivals board on the
 * right streams the run's events — all driven by the scripted `LOOP_SCRIPT`, so
 * what you see is a faithful trace, not decoration.
 *
 * Everything is keyed to a single anime.js timeline: each script step moves the
 * train to its station and, on arrival (`onBegin`), appends the event to the
 * board and pulses the station. `prefers-reduced-motion` skips all of it and
 * renders the finished map + full transcript.
 */

import { useEffect, useRef, useState } from "react";
import { animate, createTimeline, svg } from "animejs";
import { SEAM } from "../seams";
import { LOOP_SCRIPT, type Station } from "./loop-script";
import { applyEvent, foldEvents, type Line, LINE_CLASS } from "./board-lines";
import { useReducedMotion } from "./use-reduced-motion";

// ── Geometry: a rounded-rect loop with one station per side ──────────────────
const VB = { w: 600, h: 380 };
// One closed path, clockwise from the top edge. Station coords below lie on it.
const LINE_D =
  "M 205 80 H 395 A 55 55 0 0 1 450 135 V 245 A 55 55 0 0 1 395 300 H 205 A 55 55 0 0 1 150 245 V 135 A 55 55 0 0 1 205 80 Z";

const STATION_ORDER: Station[] = ["memory", "model", "tool", "stop"];

type StationDef = {
  x: number;
  y: number;
  label: string;
  sub: string;
  anchor: "start" | "middle" | "end";
  lx: number; // label x
  ly: number; // label y (first line)
};

const STATIONS: Record<Station, StationDef> = {
  memory: { x: 300, y: 80, label: "Memory", sub: "load history", anchor: "middle", lx: 300, ly: 52 },
  model: { x: 450, y: 190, label: "ModelClient", sub: "stream turn", anchor: "start", lx: 470, ly: 186 },
  tool: { x: 300, y: 300, label: "Tool", sub: "run tools", anchor: "middle", lx: 300, ly: 330 },
  stop: { x: 150, y: 190, label: "StopCondition", sub: "stop?", anchor: "end", lx: 130, ly: 186 },
};

const FINAL_LINES: Line[] = foldEvents(LOOP_SCRIPT.map((s) => s.event));

export function TransitHero() {
  const reduced = useReducedMotion();
  const mapRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const trainRef = useRef<SVGGElement>(null);
  const ringRefs = useRef<Partial<Record<Station, SVGCircleElement>>>({});
  const [lines, setLines] = useState<Line[]>(reduced ? FINAL_LINES : []);
  const [active, setActive] = useState<Station | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (reduced) {
      setLines(FINAL_LINES);
      setActive(null);
      setRunning(false);
      return;
    }

    const path = lineRef.current;
    const train = trainRef.current;
    if (!path || !train) return;

    const total = path.getTotalLength();

    // Find each station's progress (0..1) along the path by nearest-point scan.
    const progressOf = (x: number, y: number) => {
      let best = 0;
      let bestD = Infinity;
      const N = 400;
      for (let i = 0; i <= N; i += 1) {
        const p = path.getPointAtLength((total * i) / N);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i / N;
        }
      }
      return best;
    };
    const stationP = Object.fromEntries(
      STATION_ORDER.map((s) => [s, progressOf(STATIONS[s].x, STATIONS[s].y)]),
    ) as Record<Station, number>;

    const placeTrain = (virtual: number) => {
      const f = ((virtual % 1) + 1) % 1;
      const l = f * total;
      const p = path.getPointAtLength(l);
      const p2 = path.getPointAtLength((l + 1) % total);
      const ang = (Math.atan2(p2.y - p.y, p2.x - p.x) * 180) / Math.PI;
      train.setAttribute("transform", `translate(${p.x} ${p.y}) rotate(${ang})`);
    };

    const pulse = (s: Station) => {
      const ring = ringRefs.current[s];
      if (ring) animate(ring, { r: [8, 28], opacity: [0.5, 0], duration: 800, ease: "outQuad" });
    };

    // Draw the line once, then loop the train + board forever.
    const [drawable] = svg.createDrawable(path);
    const drawAnim = animate(drawable, { draw: ["0 0", "0 1"], duration: 1300, ease: "inOutSine" });

    placeTrain(stationP.memory);
    setRunning(true);

    const trainObj = { v: stationP.memory };
    const tl = createTimeline({ loop: true });
    let virtual = stationP.memory;
    let acc: Line[] = [];

    for (const step of LOOP_SCRIPT) {
      let target = virtual;
      if (step.station) {
        const base = stationP[step.station];
        let cand = Math.floor(virtual) + base;
        if (cand < virtual - 1e-6) cand += 1; // next occurrence ahead (handles wrap)
        target = cand;
      }
      const from = virtual;
      const to = target;
      const st = step.station;
      const ev = step.event;
      tl.add(trainObj, {
        v: [from, to],
        duration: step.holdMs,
        ease: to > from ? "inOutSine" : "linear",
        onBegin: () => {
          acc = applyEvent(acc, ev);
          setLines(acc);
          if (st) {
            setActive(st);
            pulse(st);
          }
        },
        onUpdate: () => placeTrain(trainObj.v),
      });
      virtual = target;
    }

    // Tail: glide back to the top (Memory) so the loop restart is seamless.
    {
      let homeward = Math.floor(virtual) + stationP.memory;
      if (homeward < virtual - 1e-6) homeward += 1;
      const from = virtual;
      tl.add(trainObj, {
        v: [from, homeward],
        duration: 900,
        ease: "inOutSine",
        onUpdate: () => placeTrain(trainObj.v),
      });
    }

    // Don't spend frames when the hero is scrolled out of view.
    let io: IntersectionObserver | undefined;
    const mapEl = mapRef.current;
    if (mapEl && "IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) tl.play();
            else tl.pause();
          }
        },
        { threshold: 0 },
      );
      io.observe(mapEl);
    }

    return () => {
      try {
        io?.disconnect();
        drawAnim.revert();
        tl.revert();
      } catch {
        // best-effort teardown
      }
    };
  }, [reduced]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
      {/* The map */}
      <div ref={mapRef} className="rounded-2xl border border-fd-border bg-fd-card/40 p-4">
        <svg
          viewBox={`0 0 ${VB.w} ${VB.h}`}
          className="h-auto w-full"
          role="img"
          aria-label="The agent loop drawn as a subway line: Memory, ModelClient, Tool, and StopCondition stations."
        >
          {/* the line */}
          <path
            ref={lineRef}
            d={LINE_D}
            fill="none"
            stroke="var(--color-fd-border)"
            strokeWidth={3}
            strokeLinejoin="round"
          />
          {/* center label */}
          <text
            x={VB.w / 2}
            y={188}
            textAnchor="middle"
            fill="var(--color-fd-muted-foreground)"
            fontFamily="var(--font-mono, ui-monospace, monospace)"
            fontSize={13}
          >
            runAgent()
          </text>
          <text
            x={VB.w / 2}
            y={206}
            textAnchor="middle"
            fill="var(--color-fd-muted-foreground)"
            opacity={0.6}
            fontFamily="var(--font-mono, ui-monospace, monospace)"
            fontSize={10}
          >
            the loop
          </text>

          {/* stations */}
          {STATION_ORDER.map((s) => {
            const def = STATIONS[s];
            const color = SEAM[s];
            const on = active === s;
            return (
              <g key={s}>
                <circle
                  ref={(el) => {
                    if (el) ringRefs.current[s] = el;
                  }}
                  cx={def.x}
                  cy={def.y}
                  r={8}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  opacity={0}
                />
                <circle cx={def.x} cy={def.y} r={7} fill="var(--color-fd-background)" stroke={color} strokeWidth={3} />
                <circle cx={def.x} cy={def.y} r={3} fill={color} opacity={on ? 1 : 0.85} />
                <text
                  x={def.lx}
                  y={def.ly}
                  textAnchor={def.anchor}
                  fontSize={13}
                  fontWeight={600}
                  fill={color}
                  opacity={on ? 1 : 0.92}
                  fontFamily="var(--font-mono, ui-monospace, monospace)"
                >
                  {def.label}
                </text>
                <text
                  x={def.lx}
                  y={def.ly + 15}
                  textAnchor={def.anchor}
                  fontSize={10}
                  fill="var(--color-fd-muted-foreground)"
                  fontFamily="var(--font-mono, ui-monospace, monospace)"
                >
                  {def.sub}
                </text>
              </g>
            );
          })}

          {/* the train (request riding the loop) */}
          <g ref={trainRef} transform={`translate(${STATIONS.memory.x} ${STATIONS.memory.y})`}>
            <rect
              x={-11}
              y={-6}
              width={22}
              height={12}
              rx={6}
              fill="var(--color-fd-primary)"
              style={{ filter: "drop-shadow(0 0 6px var(--color-fd-primary))" }}
            />
          </g>
        </svg>
      </div>

      {/* The arrivals board */}
      <div className="flex h-full min-h-[300px] flex-col rounded-2xl border border-fd-border bg-fd-card font-mono text-sm">
        <div className="flex items-center gap-2 border-b border-fd-border px-4 py-2.5 text-xs text-fd-muted-foreground">
          <span className={`size-2 rounded-full ${running ? "bg-fd-primary" : "bg-fd-muted-foreground/40"}`} />
          {running ? "live · onEvent stream" : "AgentEvent stream"}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 overflow-hidden p-4 leading-relaxed">
          {lines.map((line, i) => (
            <div key={i} className={`${LINE_CLASS[line.kind]} whitespace-pre-wrap break-words`}>
              {line.text}
              {running && i === lines.length - 1 && line.kind === "answer" && (
                <span className="ml-0.5 animate-pulse">▋</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
