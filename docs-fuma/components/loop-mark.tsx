/**
 * The Open Agent OS brand mark: a rounded-square loop with a single "station" dot
 * riding it — the transit-map hero, distilled to a glyph. Ring uses currentColor
 * so it adapts to context; the dot is theme yellow. Used in the nav and (as a
 * static copy) for the favicon and OG image.
 */
export function LoopMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="6" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="12" cy="4" r="2.7" fill="var(--color-fd-primary)" />
    </svg>
  );
}
