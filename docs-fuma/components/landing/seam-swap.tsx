"use client";

/**
 * "Swap any seam" — four cards, one per seam interface. Click a card to cycle its
 * implementation; the value morphs in place (anime fade/slide), driving home that
 * the loop depends only on the interface, never the concrete class. Re-route a
 * station without rebuilding the line.
 */

import { useRef, useState } from "react";
import { animate } from "animejs";
import { SEAM, type Seam } from "../seams";
import { useReducedMotion } from "./use-reduced-motion";

type SeamCard = { seam: Seam; iface: string; blurb: string; impls: string[] };

const CARDS: SeamCard[] = [
  {
    seam: "memory",
    iface: "Memory",
    blurb: "Where conversation history lives.",
    impls: ["SessionMemoryStore", "JSONL file store", "Redis store", "vector store"],
  },
  {
    seam: "model",
    iface: "ModelClient",
    blurb: "The LLM boundary — one stream() method.",
    impls: ["MockModelClient", "OpenAICompatibleModel", "Anthropic client", "your own"],
  },
  {
    seam: "tool",
    iface: "Tool",
    blurb: "Any capability the model can call.",
    impls: ["defineTool(weather)", "search", "deploy", "any async fn"],
  },
  {
    seam: "stop",
    iface: "StopCondition",
    blurb: "When the run should end.",
    impls: ["maxSteps(10)", "whenToolCalled(...)", "custom predicate", "terminate flag"],
  },
];

function Card({ card }: { card: SeamCard }) {
  const reduced = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const valueRef = useRef<HTMLSpanElement>(null);
  const color = SEAM[card.seam];

  function next() {
    const ni = (idx + 1) % card.impls.length;
    const el = valueRef.current;
    if (reduced || !el) {
      setIdx(ni);
      return;
    }
    animate(el, {
      opacity: [1, 0],
      translateY: [0, -8],
      duration: 160,
      ease: "inQuad",
      onComplete: () => {
        setIdx(ni);
        animate(el, { opacity: [0, 1], translateY: [8, 0], duration: 220, ease: "outQuad" });
      },
    });
  }

  return (
    <button
      type="button"
      onClick={next}
      className="group flex flex-col gap-3 rounded-xl border border-fd-border bg-fd-card p-5 text-left transition-colors hover:border-[color:var(--seam)]"
      style={{ ["--seam" as string]: color }}
    >
      <div className="flex items-center justify-between">
        <span
          className="font-mono text-xs font-bold uppercase tracking-wider"
          style={{ color }}
        >
          {card.iface} seam
        </span>
        <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
      </div>
      <p className="text-sm text-fd-muted-foreground">{card.blurb}</p>
      <div className="mt-auto">
        <div className="text-[11px] uppercase tracking-wide text-fd-muted-foreground/70">implementation</div>
        <div className="flex items-baseline gap-2 overflow-hidden font-mono text-sm">
          <span className="text-fd-muted-foreground">›</span>
          <span ref={valueRef} className="font-semibold text-fd-foreground">
            {card.impls[idx]}
          </span>
        </div>
      </div>
      <div className="text-[11px] text-fd-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100">
        click to swap →
      </div>
    </button>
  );
}

export function SeamSwap() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-16">
      <div className="mb-8 flex flex-col gap-3 text-center">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Swap any seam</h2>
        <p className="mx-auto max-w-2xl text-fd-muted-foreground">
          The loop depends only on the interface. Re-route a station — file store to
          Redis, mock model to a real one — without touching the line. Click a card to
          swap its implementation.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c) => (
          <Card key={c.seam} card={c} />
        ))}
      </div>
    </section>
  );
}
