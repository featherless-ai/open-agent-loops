/**
 * "Runs anywhere" belt — the core has no platform APIs and a single dependency
 * (zod), so the same ESM build runs across every JS runtime. Static, no client JS.
 */

const RUNTIMES = ["Node", "Bun", "Deno", "Browser"];

export function RunsAnywhere() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-16">
      <div className="rounded-2xl border border-fd-border bg-fd-card p-8 text-center">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Runs anywhere</h2>
        <p className="mx-auto mt-3 max-w-2xl text-fd-muted-foreground">
          No platform APIs, a single <code className="rounded bg-fd-muted px-1 py-0.5">zod</code>{" "}
          dependency, universal ESM. The same build drives a CLI and a browser tab — unchanged.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {RUNTIMES.map((rt) => (
            <span
              key={rt}
              className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-background px-5 py-2.5 font-mono text-sm font-semibold"
            >
              <span className="text-fd-primary">✓</span>
              {rt}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
