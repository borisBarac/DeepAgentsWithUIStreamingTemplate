import { createModelRuntime } from "../models/index.ts";

export function createTestModelRuntime() {
  return createModelRuntime({
    connections: {
      openrouter: { provider: "openrouter", apiKey: "test-key" },
    },
    models: {
      baseline: { connection: "openrouter", model: "baseline-model" },
      supervisor: { connection: "openrouter", model: "supervisor-model" },
      specialist: { connection: "openrouter", model: "specialist-model" },
    },
    assignments: {
      default: "specialist",
      baseline: "baseline",
      supervisor: "supervisor",
    },
  });
}
