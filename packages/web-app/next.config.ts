import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    turbopackImportTypeText: true,
  },
  transpilePackages: [
    "@deep-agent-template/core",
    "@deep-agent-template/image-gen",
    "@deep-agent-template/sandbox",
  ],
};

export default nextConfig;
