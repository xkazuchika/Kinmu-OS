import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/guide": ["./docs/user-guide/**/*.md"],
    "/guide/**": ["./docs/user-guide/**/*.md"],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
