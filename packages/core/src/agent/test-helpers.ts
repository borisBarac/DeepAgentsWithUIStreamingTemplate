import { createModelRuntime } from "../models/index.ts";

export function createTestModelRuntime() {
  return createModelRuntime({
    connections: {
      openrouter: { provider: "openrouter", apiKey: "test-key" },
    },
    categories: {
      fast: { connection: "openrouter", model: "fast-model" },
      normal: { connection: "openrouter", model: "normal-model" },
      pro: { connection: "openrouter", model: "pro-model" },
    },
    assignments: {
      default: "normal",
      baseline: "normal",
      supervisor: "pro",
    },
  });
}
