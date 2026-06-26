import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

// The site is served from a custom domain root (openagentloops.featherless.ai),
// so there's no basePath: NEXT_PUBLIC_BASE_PATH is unset for both local
// `bun run dev` and CI, giving `/`. Set it to `/<repo>` only if you fall back to
// project Pages (featherless-ai.github.io/<repo>). The same var is read
// client-side in app/layout.tsx to prefix the static search fetch.
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
