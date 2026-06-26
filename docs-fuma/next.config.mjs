import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

// GitHub Pages serves this project repo under a sub-path
// (https://featherless-ai.github.io/open-agent-loops/), so the build needs a
// matching basePath. It's env-driven so local `bun run dev` serves at `/` with
// no prefix, while CI sets NEXT_PUBLIC_BASE_PATH=/open-agent-loops. The same var
// is read client-side in app/layout.tsx to prefix the static search fetch.
// Next requires basePath to be a non-empty path or absent — never "".
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Fully static site for GitHub Pages: `next build` emits `out/`.
  output: "export",
  basePath,
  // Pages can't rewrite extensionless URLs, so emit `route/index.html` and link
  // with trailing slashes — this is what makes deep links resolve on Pages.
  trailingSlash: true,
  // The static export has no image-optimization server.
  images: { unoptimized: true },
  // This app has its own lockfile; pin the workspace root so Next doesn't pick
  // the repo-root bun.lock.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default withMDX(config);
