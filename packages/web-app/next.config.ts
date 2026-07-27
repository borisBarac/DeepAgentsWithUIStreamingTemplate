import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    turbopackImportTypeText: true,
  },
  serverExternalPackages: [
    "@opentelemetry/sdk-node",
    "@opentelemetry/resources",
    "@opentelemetry/semantic-conventions",
    "@opentelemetry/sdk-trace-base",
    "@opentelemetry/sdk-metrics",
    "@opentelemetry/core",
    "@opentelemetry/context-async-hooks",
  ],
  transpilePackages: [
    "@deep-agent-template/core",
    "@deep-agent-template/image-gen",
    "@deep-agent-template/sandbox",
  ],
};

export default nextConfig;
