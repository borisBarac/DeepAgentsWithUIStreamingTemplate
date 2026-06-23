import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    turbopackImportTypeText: true,
  },
  transpilePackages: ["@deep-agent-template/core"],
};

export default nextConfig;
