"use client";

import { useEffect, useState } from "react";

/**
 * Tracks the user's `prefers-reduced-motion` setting.
 *
 * SSR-safe and deliberately **defaults to `true` (reduce motion)** until mounted:
 * the static, calm fallback renders first, and animations only kick in once we've
 * confirmed on the client that the user hasn't asked to reduce motion. This also
 * avoids a hydration flash of a moving hero for people who opted out.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
