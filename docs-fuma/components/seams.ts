/**
 * The seam palette — one shared source of truth for every diagram and the
 * landing page. Nodes/stations are colored by the **seam** they exercise (the
 * swappable interface you implement), so the pluggable pieces stand out from the
 * fixed machinery. `model` and `core` track theme tokens so they follow the
 * yellow-on-black theme; the rest are fixed hues that read on both backgrounds.
 */

export const SEAM = {
  memory: "#3b82f6", // Memory — conversation storage
  model: "var(--color-fd-primary)", // ModelClient — the LLM boundary (theme yellow)
  tool: "#22c55e", // Tool — a callable capability
  stop: "#a855f7", // StopCondition — when to end the run (the loop-back gate)
  hook: "#f97316", // Hooks — optional extension points (5 of them)
  core: "var(--color-fd-border)", // fixed loop machinery (not a seam)
} as const;

export type Seam = keyof typeof SEAM;

/**
 * The interface name shown as a badge on each node, so the swappable seam is
 * labeled in place — not just inferred from its color. "core" = fixed machinery.
 */
export const SEAM_NAME: Record<Seam, string> = {
  memory: "Memory",
  model: "ModelClient",
  tool: "Tool",
  stop: "StopCondition",
  hook: "Hook",
  core: "",
};
