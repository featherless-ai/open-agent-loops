import { withAui } from "@assistant-ui/next";
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: ["@assistant-ui/react"],
  },
};

export default withAui(nextConfig);
