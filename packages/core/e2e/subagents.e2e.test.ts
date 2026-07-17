import { describe, expect, it } from "bun:test";
import {
  clarificationResultSchema,
  createDefaultSubagentCatalog,
  createRuntimeScaffold,
  createScaffoldedAgent,
} from "../src/index.ts";
import {
  type AgentInvokeResult,
  createDefaultModelRuntime,
  findTaskToolMessageWithValidPayload,
  hasLiveLLMCredentials,
  parseTaskToolPayload,
  type StructuredPayload,
} from "./helpers.ts";

const CLARIFIER_PROMPT = [
  "Incoming user request: 'Build me a CLI tool.'",
  "Decide whether this request is ready to execute or needs clarification.",
].join("\n");

const MAX_ATTEMPTS = 2;
const ERROR_MARKERS = [
  "invalid_clarification_result",
  "controller_retry_exhausted",
  "phase=error",
] as const;

function buildClarifierAgent() {
  const modelRuntime = createDefaultModelRuntime(false);
  const clarifier = createDefaultSubagentCatalog({ modelRuntime }).byRole.clarifier;
  if (!clarifier) {
    throw new Error("createDefaultSubagentCatalog did not produce a clarifier subagent.");
  }

  const scaffold = createRuntimeScaffold({
    modelRuntime: createDefaultModelRuntime(true),
    subagents: [clarifier],
  });
  if (scaffold.subagents.length !== 1) {
    throw new Error("createRuntimeScaffold did not surface exactly one subagent.");
  }

  return createScaffoldedAgent({
    modelRuntime,
    guardrails: false,
    subagents: scaffold.subagents,
  });
}

function summarizeForDiagnosis(result: AgentInvokeResult): string {
  const messages = result.messages ?? [];
  const transcript = messages
    .map((message) => {
      if (typeof message !== "object" || message === null) return "";
      const record = message as Record<string, unknown>;
      const content = record.content;
      return typeof content === "string" ? content : JSON.stringify(content ?? "");
    })
    .join("\n");
  const markers = ERROR_MARKERS.filter((marker) => transcript.includes(marker));
  const taskCount = messages.filter(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      (message as Record<string, unknown>).name === "task" &&
      typeof (message as Record<string, unknown>).tool_call_id === "string",
  ).length;
  return `taskMessages=${taskCount} markers=[${markers.join(", ") || "none"}]`;
}

describe.skipIf(!hasLiveLLMCredentials)(
  "createRuntimeScaffold clarifier live structured output",
  () => {
    it("surfaces the clarifier structured response when the supervisor delegates through the scaffolded agent", async () => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const agent = buildClarifierAgent();
          const result = (await agent.invoke({
            messages: [{ role: "user", content: CLARIFIER_PROMPT }],
          })) as AgentInvokeResult;

          console.log(`[attempt ${attempt}] result:`, result);

          const message = findTaskToolMessageWithValidPayload(
            result.messages,
            (payload) => clarificationResultSchema.safeParse(payload).success,
          );
          if (!message) {
            throw new Error(
              `No task tool message carried a schema-valid clarification payload (${summarizeForDiagnosis(result)}).`,
            );
          }

          const payload = parseTaskToolPayload(message) as StructuredPayload;
          console.log(`[attempt ${attempt}] clarifier payload:`, payload);

          expect(() => clarificationResultSchema.parse(payload)).not.toThrow();
          expect(["needs_clarification", "ready_to_proceed", "blocked"]).toContain(
            payload.status as string,
          );
          return;
        } catch (error) {
          lastError = error;
          console.error(`[attempt ${attempt}] failed:`, error);
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error(`Clarifier e2e failed after ${MAX_ATTEMPTS} attempts`);
    }, 120_000);
  },
);
