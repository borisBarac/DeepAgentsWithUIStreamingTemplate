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
  findToolMessage,
  hasLiveLLMCredentials,
  parseToolMessagePayload,
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
    triageClassifier: {
      async invoke() {
        return { decision: "proceed", reason: "The request has unresolved implementation scope." };
      },
    },
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
  const submissionCount = messages.filter(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      (message as Record<string, unknown>).name === "workflow_submit_clarification" &&
      typeof (message as Record<string, unknown>).tool_call_id === "string",
  ).length;
  return `clarificationSubmissions=${submissionCount} markers=[${markers.join(", ") || "none"}]`;
}

describe.skipIf(!hasLiveLLMCredentials)(
  "createRuntimeScaffold clarifier live structured output",
  () => {
    it("accepts the supervisor's schema-enforced clarification submission", async () => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const agent = buildClarifierAgent();
          const result = (await agent.invoke({
            messages: [{ role: "user", content: CLARIFIER_PROMPT }],
          })) as AgentInvokeResult;

          console.log(`[attempt ${attempt}] result:`, result);

          const submission = parseToolMessagePayload(
            findToolMessage(result.messages, "workflow_submit_clarification"),
            "workflow_submit_clarification",
          );
          if (submission.status !== "accepted") {
            throw new Error(
              `Clarification submission was not accepted (${summarizeForDiagnosis(result)}).`,
            );
          }

          const parsed = clarificationResultSchema.parse(submission.result);
          console.log(`[attempt ${attempt}] accepted clarification result:`, parsed);

          expect(["waiting_for_user", "execution"]).toContain(submission.nextPhase as string);
          expect(["needs_clarification", "ready_to_proceed", "blocked"]).toContain(parsed.status);
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
