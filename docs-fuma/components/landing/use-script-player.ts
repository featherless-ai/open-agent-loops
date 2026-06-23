"use client";

import { useEffect, useState } from "react";
import { createTimeline } from "animejs";
import { LOOP_SCRIPT } from "./loop-script";

/**
 * Plays the scripted run on a loop, returning how many events have elapsed
 * (0..LOOP_SCRIPT.length). Consumers render `LOOP_SCRIPT.slice(0, step)`, so a
 * single clock drives every panel in lockstep. Each step lasts its own `holdMs`,
 * matching the hero's pacing.
 *
 * When `enabled` is false (reduced motion / SSR) it parks at the full count so
 * the static view shows the whole transcript.
 */
export function useScriptPlayer(enabled: boolean): number {
  const [step, setStep] = useState(LOOP_SCRIPT.length);

  useEffect(() => {
    if (!enabled) {
      setStep(LOOP_SCRIPT.length);
      return;
    }
    setStep(0);
    const obj = { i: 0 };
    const tl = createTimeline({ loop: true });
    LOOP_SCRIPT.forEach((s, idx) => {
      tl.add(obj, { i: [idx, idx], duration: s.holdMs, onBegin: () => setStep(idx + 1) });
    });
    tl.add(obj, { i: [0, 0], duration: 1200 }); // hold the finished run before looping

    return () => {
      try {
        tl.revert();
      } catch {
        // best-effort teardown
      }
    };
  }, [enabled]);

  return step;
}
