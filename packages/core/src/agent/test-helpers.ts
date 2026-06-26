import { createModelRuntime } from "../models/index.ts";

export function createTestModelRuntime() {
  return createModelRuntime({
    connections: {
      compat: {
        provider: "openai-compatible",
        apiKey: "test-key",
        baseURL: "https://example.com/v1",
      },
    },
    categories: {
      fast: { connection: "compat", model: "fast-model" },
      normal: { connection: "compat", model: "normal-model" },
      pro: { connection: "compat", model: "pro-model" },
    },
    assignments: {
      default: "normal",
      baseline: "normal",
      supervisor: "pro",
    },
  });
}
