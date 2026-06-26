import { createModelRuntime } from "../src/models/index.ts";
import { configureLangSmithTracing } from "../src/observability/index.ts";

const projectName = process.env.LANGSMITH_PROJECT ?? "deep-agent-template";
const verificationId = `langsmith-error-smoke-${Date.now()}`;

if (!process.env.LANGSMITH_API_KEY) {
  console.error("LANGSMITH_API_KEY is required to submit the smoke-test trace.");
  process.exit(1);
}

process.env.LANGCHAIN_CALLBACKS_BACKGROUND = "false";
configureLangSmithTracing({ enabled: true, projectName });

const modelRuntime = createModelRuntime({
  connections: {
    compat: {
      provider: "openai-compatible",
      apiKey: "intentionally-invalid-key",
      baseURL: "https://invalid-host.example.com/v1",
    },
  },
  categories: {
    fast: { connection: "compat", model: "gpt-4o-mini", maxRetries: 0 },
    normal: { connection: "compat", model: "gpt-4o-mini", maxRetries: 0 },
    pro: { connection: "compat", model: "gpt-4o-mini", maxRetries: 0 },
  },
  assignments: { default: "normal" },
});

try {
  await modelRuntime.getModelForCategory("normal").invoke("Reply with: tracing verified", {
    runName: "deep-agent-template-langsmith-error-smoke",
    tags: ["langsmith-smoke", "expected-error"],
    metadata: { verificationId },
    signal: AbortSignal.timeout(10_000),
  });
  console.error("The smoke-test model call unexpectedly succeeded.");
  process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`Caught expected model error: ${message}`);
  console.log(`LangSmith project: ${projectName}`);
  console.log(`Trace marker: ${verificationId}`);
}
