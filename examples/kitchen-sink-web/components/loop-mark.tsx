/**
 * Open Agent Loops brand mark — a rounded-square loop with a single "station" dot
 * riding it. The ring uses `currentColor` so it adapts to the surrounding text
 * color; the dot is the brand yellow.
 *
 * Mirrors `docs-fuma/components/loop-mark.tsx`. That copy fills the dot with
 * fumadocs' `--color-fd-primary`; this standalone example has no such token, so
 * we hardcode the canonical brand yellow (`#facc15`, matching the favicon SVG).
 */
export function LoopMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="6" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="12" cy="4" r="2.7" fill="#facc15" />
    </svg>
  );
}
