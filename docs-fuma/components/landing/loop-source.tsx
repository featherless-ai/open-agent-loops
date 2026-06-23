/**
 * "The whole loop fits on one screen" — the credibility anchor for a minimal
 * library: let people read it. This is a distilled view of the real `while (true)`
 * body in `agent-core/primitives/loop.ts` (~lines 323–423), trimmed of comments
 * and error-path detail; the control flow is faithful. Each line is tinted by the
 * seam it exercises, keyed to the same palette as the transit map.
 *
 * Static text on purpose — if the core loop changes materially, re-sync it here.
 */

import { SEAM, SEAM_NAME, type Seam } from "../seams";

const GITHUB_LOOP = "https://github.com/ArEnSc/advance-agent/blob/main/agent-core/primitives/loop.ts";

type CodeLine = { t: string; seam?: Seam; comment?: boolean };

const LINES: CodeLine[] = [
  { t: "while (true) {" },
  { t: "  signal?.throwIfAborted();" },
  { t: "  await emit({ type: TurnStart, step: ++steps });" },
  { t: "" },
  { t: "  // stream the assistant turn", comment: true },
  { t: "  const ctx = hooks.transformContext?.(messages) ?? messages;", seam: "hook" },
  { t: "  const assistant = await streamAssistant(model, { system, messages: ctx, tools }, emit);", seam: "model" },
  { t: "  messages.push(assistant);", seam: "memory" },
  { t: "  await memory.append(sessionId, [assistant]);", seam: "memory" },
  { t: "" },
  { t: "  const toolCalls = assistant.tool_calls ?? [];" },
  { t: "  if (toolCalls.length === 0) {              // a final answer", seam: "stop" },
  { t: "    const followUps = (await hooks.drainFollowUp?.()) ?? [];", seam: "hook" },
  { t: "    if (followUps.length === 0) break;", seam: "stop" },
  { t: "    inject(followUps); continue;" },
  { t: "  }" },
  { t: "" },
  { t: "  const gate = await gateToolBatch(toolCalls, toolsByName, hooks);", seam: "hook" },
  { t: "  const { results, terminate } = await executeToolCalls(approved, …);", seam: "tool" },
  { t: "  messages.push(...results);", seam: "memory" },
  { t: "  await memory.append(sessionId, results);", seam: "memory" },
  { t: "" },
  { t: "  if (terminate) break;", seam: "stop" },
  { t: "  if (await stopWhen?.({ step: steps, assistant, results })) break;", seam: "stop" },
  { t: "  if (steps >= maxSteps) break;             // the hard cap", seam: "stop" },
  { t: "}" },
];

const LEGEND: Seam[] = ["memory", "model", "tool", "stop", "hook"];

export function LoopSource() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-16">
      <div className="mb-8 flex flex-col gap-3 text-center">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">The whole loop fits on one screen</h2>
        <p className="mx-auto max-w-2xl text-fd-muted-foreground">
          No hidden control flow. This is the core of{" "}
          <code className="rounded bg-fd-muted px-1 py-0.5">runAgent()</code> — every line tinted by the
          seam it touches. Read it in a minute, swap any part.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_0.9fr] lg:items-start">
        {/* the code */}
        <div className="overflow-x-auto rounded-2xl border border-fd-border bg-fd-card p-4">
          <pre className="font-mono text-[12.5px] leading-relaxed">
            <code>
              {LINES.map((line, i) => (
                <div
                  key={i}
                  className="min-h-[1.4em] border-l-2 pl-3"
                  style={{
                    borderColor: line.seam ? SEAM[line.seam] : "transparent",
                    color: line.comment
                      ? "var(--color-fd-muted-foreground)"
                      : "var(--color-fd-foreground)",
                    background: line.seam ? `color-mix(in srgb, ${SEAM[line.seam]} 7%, transparent)` : "transparent",
                  }}
                >
                  {line.t || " "}
                </div>
              ))}
            </code>
          </pre>
        </div>

        {/* legend + stat */}
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-fd-border bg-fd-card p-5">
            <div className="font-mono text-3xl font-bold">~25 lines</div>
            <p className="mt-1 text-sm text-fd-muted-foreground">
              one file, one dependency. The rest of the package is just the seams plugged into it.
            </p>
          </div>
          <ul className="flex flex-col gap-2.5">
            {LEGEND.map((s) => (
              <li key={s} className="flex items-center gap-3 text-sm">
                <span className="h-3 w-5 shrink-0 rounded-sm" style={{ background: SEAM[s] }} />
                <span className="font-mono font-semibold" style={{ color: SEAM[s] }}>
                  {SEAM_NAME[s] || "Hook"}
                </span>
                <span className="text-fd-muted-foreground">
                  {s === "hook" ? "optional extension points" : "swappable seam"}
                </span>
              </li>
            ))}
          </ul>
          <a
            href={GITHUB_LOOP}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-fd-primary underline-offset-4 hover:underline"
          >
            Read the real loop.ts on GitHub →
          </a>
        </div>
      </div>
    </section>
  );
}
