import type { Metadata } from "next";
import Link from "next/link";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "./layout.config";
import { InstallCommand } from "@/components/landing/install-command";
import { TransitHero } from "@/components/landing/transit-hero";
import { SeamSwap } from "@/components/landing/seam-swap";
import { ByoFrontend } from "@/components/landing/byo-frontend";
import { SeamTour } from "@/components/landing/seam-tour";
import { TraceReplay } from "@/components/landing/trace-replay";
import { LoopSource } from "@/components/landing/loop-source";
import { RunsAnywhere } from "@/components/landing/runs-anywhere";

const GITHUB = "https://github.com/ArEnSc/advance-agent";
const NPM = "https://www.npmjs.com/package/@open-agent-loops/core";

export const metadata: Metadata = {
  title: "Open Agent OS — a minimal, provider-agnostic agent loop",
  description:
    "A headless, provider-agnostic agentic loop. Every piece — memory, model, tools, stop conditions — sits behind a swappable interface. Streaming by default, one dependency, runs anywhere.",
  openGraph: {
    title: "Open Agent OS",
    description:
      "A minimal, provider-agnostic agent loop built on swappable seams. Bring your own front end; runs in Node, Bun, Deno, and the browser.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Open Agent OS",
    description: "A minimal, provider-agnostic agent loop built on swappable seams.",
  },
};

export default function HomePage() {
  return (
    <HomeLayout {...baseOptions}>
      <main className="flex flex-1 flex-col">
        <Hero />
        <Quickstart />
        <SeamSwap />
        <ByoFrontend />
        <SeamTour />
        <LoopSource />
        <TraceReplay />
        <RunsAnywhere />
        <FeatureGrid />
        <CallToAction />
      </main>
    </HomeLayout>
  );
}

const QUICKSTART = `import { runAgent, SessionMemoryStore, defineTool } from "@open-agent-loops/core";
import { OpenAICompatibleModel } from "@open-agent-loops/core/providers/openai";
import { z } from "zod";

// A tool is a name, a schema, and a function.
const weather = defineTool({
  name: "weather",
  description: "Get the weather for a city.",
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => ({ content: \`Sunny in \${city}\` }),
});

const result = await runAgent({
  model: new OpenAICompatibleModel({ baseURL, apiKey, model }),
  memory: new SessionMemoryStore(),
  sessionId: "demo",
  prompt: "What's the weather in Paris?",
  tools: [weather],
  onEvent: (e) => render(e), // the loop is headless — render events your way
});

console.log(result.messages.at(-1)?.content); // "It's sunny in Paris."`;

function Quickstart() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-16">
      <div className="mb-6 flex flex-col gap-3 text-center">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">From zero to a running agent</h2>
        <p className="mx-auto max-w-2xl text-fd-muted-foreground">
          Define a tool, hand it to the loop, render the stream. That's the whole API surface.
        </p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-fd-border bg-fd-card p-5">
        <pre className="font-mono text-[12.5px] leading-relaxed text-fd-foreground">
          <code>{QUICKSTART}</code>
        </pre>
      </div>
      <div className="mt-4 text-center">
        <Link href="/docs/getting-started" className="text-sm text-fd-primary underline-offset-4 hover:underline">
          Full walkthrough in Getting Started →
        </Link>
      </div>
    </section>
  );
}

const FEATURES: { title: string; body: string; href: string }[] = [
  { title: "Streaming by default", href: "/docs/messages-and-the-wire-format", body: "stream() returns an async iterable of StreamEvents — reasoning, text, and tool calls arrive incrementally." },
  { title: "Skills", href: "/docs/skills", body: "Bundle instructions, tools, and reference material the model loads on demand — then guard the bundle with a secret and an approval." },
  { title: "Planning tools", href: "/docs/planning-tools", body: "Give the model durable working memory: a to-do list and a scratchpad it keeps across turns, freezable into a replayable workflow." },
  { title: "Composable agents", href: "/docs/agent-as-tool", body: "Wrap an agent as a tool another agent calls — a multi-agent orchestrator over one chat, each sub-agent context-isolated." },
  { title: "Channels & steering", href: "/docs/channels", body: "Feed a live, bursty transport (Slack, Discord) through one bounded, coalescing queue, and inject messages mid-run." },
  { title: "Goal loops", href: "/docs/goal-loops", body: "An outer runGoal loop with a grader seam drives the inner loop until the goal is met." },
  { title: "Tracing built in", href: "/docs/tracing", body: "A passive Tracer records the run as a timestamped timeline and per-turn trajectory, off the hot path." },
  { title: "Permissioned tool calls", href: "/docs/gating-tool-calls", body: "Gate the whole turn's tool calls up front with an allow / deny / ask policy — no race with parallel execution." },
  { title: "Independently testable", href: "/docs/getting-started", body: "Every seam is verified in isolation with deterministic test doubles — zero network." },
];

function FeatureGrid() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-16">
      <div className="mb-8 flex flex-col gap-3 text-center">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Composable building blocks</h2>
        <p className="mx-auto max-w-2xl text-fd-muted-foreground">
          Skills, planning, sub-agents, channels — each built <em>over</em>{" "}
          <code className="rounded bg-fd-muted px-1 py-0.5">runAgent()</code>, never into it. Add
          what you need, ignore the rest.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Link
            key={f.title}
            href={f.href}
            className="group flex flex-col gap-2 rounded-xl border border-fd-border bg-fd-card p-5 transition-colors hover:border-fd-primary/60"
          >
            <h3 className="font-semibold">
              {f.title}
              <span className="ml-1 text-fd-muted-foreground transition-transform group-hover:translate-x-0.5 inline-block">
                →
              </span>
            </h3>
            <p className="text-sm text-fd-muted-foreground">{f.body}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function CallToAction() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-24 pt-8">
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-fd-border bg-fd-card px-6 py-14 text-center">
        <h2 className="text-balance text-3xl font-bold tracking-tight md:text-4xl">Build your agent</h2>
        <p className="max-w-xl text-fd-muted-foreground">
          Start from the loop, plug in your seams, render it your way.
        </p>
        <InstallCommand />
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs/getting-started"
            className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-semibold text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
          <Link
            href="/docs"
            className="rounded-lg border border-fd-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-accent"
          >
            Docs
          </Link>
          <a
            href={GITHUB}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-fd-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-accent"
          >
            GitHub
          </a>
          <a
            href={NPM}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-fd-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-accent"
          >
            npm
          </a>
        </div>
      </div>
    </section>
  );
}

function Hero() {
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-20 md:py-28">
      <div className="flex flex-col gap-6 text-center">
        <span className="mx-auto inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card px-3 py-1 font-mono text-xs text-fd-muted-foreground">
          <span className="size-1.5 rounded-full bg-fd-primary" />
          headless · provider-agnostic · one dependency
        </span>

        <h1 className="text-balance text-4xl font-bold tracking-tight md:text-6xl">
          Open Agent OS
        </h1>

        <p className="mx-auto max-w-2xl text-balance text-lg text-fd-muted-foreground md:text-xl">
          The fundamental pieces to build and extend your own agent — your Jarvis,
          your Cortana, your Samantha. A minimal agentic loop where every piece sits
          behind a swappable interface.
        </p>

        <div className="mx-auto flex flex-col items-center gap-4">
          <InstallCommand />
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/docs/getting-started"
              className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-semibold text-fd-primary-foreground transition-opacity hover:opacity-90"
            >
              Get started
            </Link>
            <Link
              href="/docs"
              className="rounded-lg border border-fd-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-accent"
            >
              Read the docs
            </Link>
            <a
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-fd-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-fd-accent"
            >
              GitHub
            </a>
          </div>
        </div>
      </div>

      <TransitHero />
    </section>
  );
}
