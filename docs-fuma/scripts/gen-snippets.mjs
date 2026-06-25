// Materializes doc code snippets from the runnable examples, so a doc
// `<include>` always reflects the real example — single source of truth, no
// drift. Turbopack refuses to `<include>` files outside the docs-fuma project
// root (the examples live at the repo root), so we extract the marked region,
// rewrite the example's dev imports to the published package names, and write
// the result into docs-fuma/snippets/ (which the docs include from in-root).
//
// Run from docs-fuma/:  npm run snippets   (also runs on predev / prebuild)
import { readFileSync, writeFileSync, mkdirSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, ".."); // docs-fuma
const repo = join(root, ".."); // repo root

/** Each example region → a generated `.mdx` code-block snippet. */
const SNIPPETS = [
  {
    src: "examples/single-turn-loop/single-turn-loop.ts",
    region: "single-turn-loop",
    out: "snippets/single-turn-loop.mdx",
    title: "examples/single-turn-loop/single-turn-loop.ts",
  },
  {
    src: "examples/multi-turn-chat/multi-turn-chat.ts",
    region: "chat-loop",
    out: "snippets/multi-turn-chat-loop.mdx",
    title: "examples/multi-turn-chat/multi-turn-chat.ts",
  },
  {
    src: "examples/tool-tutorial/step1.ts",
    region: "step1",
    out: "snippets/tool-step1.mdx",
    title: "examples/tool-tutorial/step1.ts",
  },
  {
    src: "examples/tool-tutorial/step2.ts",
    region: "step2",
    out: "snippets/tool-step2.mdx",
    title: "examples/tool-tutorial/step2.ts",
  },
  {
    src: "examples/tool-tutorial/step3.ts",
    region: "step3",
    out: "snippets/tool-step3.mdx",
    title: "examples/tool-tutorial/step3.ts",
  },
  {
    src: "examples/tool-tutorial/step4.ts",
    region: "step4",
    out: "snippets/tool-step4.mdx",
    title: "examples/tool-tutorial/step4.ts",
  },
  {
    src: "examples/tool-tutorial/step5.ts",
    region: "step5",
    out: "snippets/tool-step5.mdx",
    title: "examples/tool-tutorial/step5.ts",
  },
  {
    src: "examples/skill-tutorial/step1.ts",
    region: "step1",
    out: "snippets/skill-step1.mdx",
    title: "examples/skill-tutorial/step1.ts",
  },
  {
    src: "examples/skill-tutorial/step2.ts",
    region: "step2",
    out: "snippets/skill-step2.mdx",
    title: "examples/skill-tutorial/step2.ts",
  },
  {
    src: "examples/skill-tutorial/step3.ts",
    region: "step3",
    out: "snippets/skill-step3.mdx",
    title: "examples/skill-tutorial/step3.ts",
  },
  {
    src: "examples/skill-tutorial/step4.ts",
    region: "step4",
    out: "snippets/skill-step4.mdx",
    title: "examples/skill-tutorial/step4.ts",
  },
  {
    src: "examples/planning-tutorial/step1.ts",
    region: "step1",
    out: "snippets/planning-step1.mdx",
    title: "examples/planning-tutorial/step1.ts",
  },
  {
    src: "examples/planning-tutorial/step2.ts",
    region: "step2",
    out: "snippets/planning-step2.mdx",
    title: "examples/planning-tutorial/step2.ts",
  },
  {
    src: "examples/planning-tutorial/step3.ts",
    region: "step3",
    out: "snippets/planning-step3.mdx",
    title: "examples/planning-tutorial/step3.ts",
  },
  {
    src: "examples/planning-tutorial/step4.ts",
    region: "step4",
    out: "snippets/planning-step4.mdx",
    title: "examples/planning-tutorial/step4.ts",
  },
  {
    src: "examples/tracing-tutorial/step1.ts",
    region: "step1",
    out: "snippets/tracing-step1.mdx",
    title: "examples/tracing-tutorial/step1.ts",
  },
  {
    src: "examples/tracing-tutorial/step2.ts",
    region: "step2",
    out: "snippets/tracing-step2.mdx",
    title: "examples/tracing-tutorial/step2.ts",
  },
  {
    src: "examples/tracing-tutorial/step3.ts",
    region: "step3",
    out: "snippets/tracing-step3.mdx",
    title: "examples/tracing-tutorial/step3.ts",
  },
  {
    src: "examples/code-execution-tutorial/step1.ts",
    region: "step1",
    out: "snippets/code-exec-step1.mdx",
    title: "examples/code-execution-tutorial/step1.ts",
  },
  {
    src: "examples/code-execution-tutorial/step2.ts",
    region: "step2",
    out: "snippets/code-exec-step2.mdx",
    title: "examples/code-execution-tutorial/step2.ts",
  },
  {
    src: "examples/code-execution-tutorial/step3.ts",
    region: "step3",
    out: "snippets/code-exec-step3.mdx",
    title: "examples/code-execution-tutorial/step3.ts",
  },
  {
    src: "examples/code-execution-tutorial/step4.ts",
    region: "step4",
    out: "snippets/code-exec-step4.mdx",
    title: "examples/code-execution-tutorial/step4.ts",
  },
  {
    src: "examples/goal-tutorial/step1.ts",
    region: "step1",
    out: "snippets/goal-step1.mdx",
    title: "examples/goal-tutorial/step1.ts",
  },
  {
    src: "examples/goal-tutorial/step2.ts",
    region: "step2",
    out: "snippets/goal-step2.mdx",
    title: "examples/goal-tutorial/step2.ts",
  },
  {
    src: "examples/goal-tutorial/step3.ts",
    region: "step3",
    out: "snippets/goal-step3.mdx",
    title: "examples/goal-tutorial/step3.ts",
  },
  {
    src: "examples/goal-tutorial/step4.ts",
    region: "step4",
    out: "snippets/goal-step4.mdx",
    title: "examples/goal-tutorial/step4.ts",
  },
  {
    src: "examples/channels-tutorial/step1.ts",
    region: "step1",
    out: "snippets/channels-step1.mdx",
    title: "examples/channels-tutorial/step1.ts",
  },
];

// Example dev imports (relative, to TS source) → published package specifiers.
const IMPORT_REWRITES = [
  [/(["'])(?:\.\.\/)+agent-loop-core\/providers\/openai-compatible\.ts\1/g, '"@open-agent-loops/agent-loop-core/providers/openai"'],
  [/(["'])(?:\.\.\/)+agent-loop-core\/index\.ts\1/g, '"@open-agent-loops/agent-loop-core"'],
  // bunShellBackend is host glue (you bring your own ShellBackend), not a package
  // export — present it as a local module the reader provides.
  [/(["'])(?:\.\.\/)+bun-backends\.ts\1/g, '"./bun-backends"'],
  // denoCodeExecutionBackend is the same: host glue you bring (the reference
  // CodeExecutionBackend), not a package export — present it as a local module.
  [/(["'])(?:\.\.\/)+deno-backends\.ts\1/g, '"./deno-backends"'],
];

/** Extract a `// #region name` … `// #endregion` block and dedent it. */
function extractRegion(content, name) {
  const start = new RegExp(`^\\s*//\\s*#?region\\b\\s*${name}\\s*$`);
  const end = /^\s*\/\/\s*#?endregion\b/;
  const lines = content.split("\n");
  const from = lines.findIndex((l) => start.test(l));
  if (from === -1) throw new Error(`region "${name}" not found`);
  const body = [];
  for (let i = from + 1; i < lines.length; i++) {
    if (end.test(lines[i])) {
      const indent = body
        .filter((l) => l.trim())
        .reduce((m, l) => Math.min(m, l.match(/^(\s*)/)[1].length), Infinity);
      const out = indent === Infinity ? body : body.map((l) => l.slice(indent));
      return out.join("\n").trim();
    }
    body.push(lines[i]);
  }
  throw new Error(`region "${name}" not closed`);
}

function generate() {
  let n = 0;
  for (const s of SNIPPETS) {
    try {
      let code = extractRegion(readFileSync(join(repo, s.src), "utf8"), s.region);
      for (const [re, to] of IMPORT_REWRITES) code = code.replace(re, to);
      const out = join(root, s.out);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, "```ts title=\"" + s.title + "\"\n" + code + "\n```\n");
      n += 1;
    } catch (e) {
      // Don't crash the watcher on a transient read mid-save.
      console.error(`snippet ${s.src}: ${e.message}`);
    }
  }
  return n;
}

console.log(`Generated ${generate()} doc snippet(s) from examples.`);

// --watch: regenerate when an example changes, so a doc refresh (or HMR) shows
// the edit live. The dev server watches the snippet; this keeps the snippet in
// sync with its source example.
if (process.argv.includes("--watch")) {
  let timer;
  const rerun = () => {
    clearTimeout(timer);
    timer = setTimeout(() => console.log(`Regenerated ${generate()} snippet(s).`), 100);
  };
  for (const s of SNIPPETS) {
    try {
      watch(join(repo, s.src), rerun);
    } catch (e) {
      console.error(`watch ${s.src}: ${e.message}`);
    }
  }
  console.log("Watching examples for changes…");
}
