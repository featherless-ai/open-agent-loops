/**
 * "Works with any OpenAI-compatible model" strip — honest social proof for a
 * provider-agnostic loop. The `ModelClient` seam targets the OpenAI
 * chat-completions wire format, so any endpoint that speaks it drops in. The
 * chips are the open-model families exercised in `system-tests/agentic-models.json`
 * (served on Featherless) — real integrations, not borrowed logos. Static, no
 * client JS; tinted with the `model` seam color to match the transit-map palette.
 */

import { SEAM } from "../seams";

// Tested families, straight from system-tests/agentic-models.json. Keep in sync
// when a family is added there.
const FAMILIES = ["DeepSeek", "GLM", "Qwen", "Kimi", "MiniMax", "Gemma", "Step"];

const BYO_MODEL_DOC = "/docs/bring-your-own-model-client";

export function WorksWith() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-16">
      <div className="rounded-2xl border border-fd-border bg-fd-card p-8 text-center">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
          Works with any OpenAI-compatible model
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-fd-muted-foreground">
          The <code className="rounded bg-fd-muted px-1 py-0.5">ModelClient</code> seam targets the
          OpenAI chat-completions wire format, so any endpoint that speaks it drops straight in.
          Exercised across these open-model families on{" "}
          <span className="font-semibold text-fd-foreground">Featherless</span>:
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {FAMILIES.map((family) => (
            <span
              key={family}
              className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-background px-5 py-2.5 font-mono text-sm font-semibold"
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: SEAM.model }}
              />
              {family}
            </span>
          ))}
        </div>
        <a
          href={BYO_MODEL_DOC}
          className="mt-7 inline-block text-sm text-fd-primary underline-offset-4 hover:underline"
        >
          Bring your own model client →
        </a>
      </div>
    </section>
  );
}
