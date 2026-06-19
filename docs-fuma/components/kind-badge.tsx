// Small per-item kind badge for the API reference sidebar. Pages carry an
// `icon: <kind>` or `icon: <kind>:<seam>` frontmatter (written by
// scripts/gen-api-meta.mjs); `kindIcon` is the loader's icon resolver.
//
// Two orthogonal dimensions: the letter + tint encode the TypeScript *kind*
// (class/interface/enum/type/function/variable); a swappable loop *seam* adds a
// colored ring in its seam color — kept in sync with the loop diagram's palette
// (components/loop-diagram.tsx).
const KINDS: Record<string, { label: string; className: string }> = {
  class: { label: "C", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  interface: { label: "I", className: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  enum: { label: "E", className: "bg-purple-500/15 text-purple-600 dark:text-purple-400" },
  type: { label: "T", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  function: { label: "ƒ", className: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  variable: { label: "V", className: "bg-slate-500/15 text-slate-600 dark:text-slate-400" },
};

const SEAMS: Record<string, { color: string; name: string }> = {
  memory: { color: "#3b82f6", name: "Memory" },
  model: { color: "var(--color-fd-primary)", name: "ModelClient" },
  tool: { color: "#22c55e", name: "Tool" },
  stop: { color: "#a855f7", name: "StopCondition" },
  hook: { color: "#f97316", name: "Hooks" },
};

export function KindBadge({ kind, seam }: { kind: string; seam?: string }) {
  const k = KINDS[kind];
  if (!k) return null;
  const s = seam ? SEAMS[seam] : undefined;
  return (
    <span
      className={`inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] font-mono text-[10px] font-semibold leading-none ${k.className}`}
      // A swappable seam gets a ring in its seam color, offset from the badge by
      // the sidebar background so it reads as a ring rather than a thick border.
      style={s ? { boxShadow: `0 0 0 1px var(--color-fd-background), 0 0 0 2.5px ${s.color}` } : undefined}
      title={s ? `${kind} · ${s.name} seam` : kind}
      aria-hidden
    >
      {k.label}
    </span>
  );
}

export function kindIcon(name: string | undefined) {
  if (!name) return undefined;
  const [kind, seam] = name.split(":");
  return <KindBadge kind={kind} seam={seam} />;
}
