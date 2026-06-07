import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // This app has its own lockfile; pin the workspace root so Next doesn't pick
  // the repo-root bun.lock.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default withMDX(config);
