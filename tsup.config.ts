import { defineConfig } from "tsup";

// Builds the published artifact: a portable ESM bundle + bundled `.d.ts` per
// entry. The source has zero platform-specific APIs (no `node:` imports, no
// `Bun.*`, no `process`/`Buffer` at runtime), so a single ESM build runs in
// Node, Bun, Deno, and the browser — no per-runtime forks.
//
// `openai` and `zod` stay external: `zod` is a hard dependency, `openai` an
// optional peer imported only by the OpenAI-compatible provider. Externalizing
// them lets the consumer's bundler dedupe, and keeps `openai` out of a browser
// bundle entirely unless the provider is actually imported.
export default defineConfig({
  entry: {
    index: "agent-core/index.ts",
    // Streaming test double — handy client-side for building UI with no backend.
    "mocks/mock-model": "agent-core/mocks/mock-model.ts",
    // Server-side opt-in: the OpenAI-compatible ModelClient. Kept out of the
    // core entry so importing `agent-core` never pulls `openai` into a browser
    // bundle — consumers reach for it explicitly via `agent-core/providers/openai`.
    "providers/openai": "agent-core/providers/openai-compatible.ts",
  },
  format: ["esm"],
  target: "es2022",
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  external: ["openai", "zod"],
});
