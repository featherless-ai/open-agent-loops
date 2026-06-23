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

export default function HomePage() {
  return (
    <HomeLayout {...baseOptions}>
      <main className="flex flex-1 flex-col">
        <Hero />
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

const FEATURES: { title: string; body: string }[] = [
  { title: "Streaming by default", body: "stream() returns an async iterable of StreamEvents — reasoning, text, and tool calls arrive incrementally." },
  { title: "Provider-agnostic", body: "Nothing in the core references a specific LLM SDK. Any OpenAI-compatible endpoint works with a raw fetch." },
  { title: "Independently testable", body: "Each seam is verified in isolation with deterministic test doubles — zero network." },
  { title: "Tracing built in", body: "A passive Tracer records the run as a timestamped timeline and per-turn trajectory, off the hot path." },
  { title: "Permissioned tool calls", body: "Gate the whole turn's tool calls up front with an allow / deny / ask policy — no race with parallel execution." },
  { title: "Goal loops", body: "An outer runGoal loop with a grader seam drives the inner loop until a goal is met." },
];

function FeatureGrid() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-16">
      <div className="mb-8 flex flex-col gap-3 text-center">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Everything behind a seam</h2>
        <p className="mx-auto max-w-2xl text-fd-muted-foreground">
          Small, sharp pieces you can test, swap, and observe in isolation.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="flex flex-col gap-2 rounded-xl border border-fd-border bg-fd-card p-5">
            <h3 className="font-semibold">{f.title}</h3>
            <p className="text-sm text-fd-muted-foreground">{f.body}</p>
          </div>
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
