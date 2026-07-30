import { describe, expect, it } from "bun:test";
import { createDefaultSubagentCatalog, createScaffoldedAgent } from "../src/index.ts";
import {
  type AgentInvokeResult,
  collectTaskDelegations,
  collectWorkflowSubmissions,
  createDefaultModelRuntime,
  hasLiveLLMCredentials,
  LIVE_ATTEMPT_TIMEOUT_MS,
  LIVE_MAX_ATTEMPTS,
  LIVE_TEST_TIMEOUT_MS,
  runWithRetry,
} from "./helpers.ts";

/**
 * Exercises the production agent wiring (createScaffoldedAgent with the
 * workflow controller active) through natural prompts. The controller drives
 * the supervisor through its phase machine; we assert only on the observable
 * outcome — a subagent was delegated to and its typed submission was accepted.
 */

function buildDelegationAgent() {
  const modelRuntime = createDefaultModelRuntime(false);
  const catalog = createDefaultSubagentCatalog({ modelRuntime });
  const clarifier = catalog.byRole.clarifier;
  const reviewer = catalog.byRole.reviewer;
  if (!clarifier) throw new Error("createDefaultSubagentCatalog did not produce a clarifier.");
  if (!reviewer) throw new Error("createDefaultSubagentCatalog did not produce a reviewer.");
  return createScaffoldedAgent({
    modelRuntime,
    guardrails: false,
    subagents: [clarifier, reviewer],
    reviewOptions: { maxReviewCycles: 1 },
  });
}

function threadId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

describe.skipIf(!hasLiveLLMCredentials)("agent subagent delegation live e2e", () => {
  it(
    "delegates to the clarifier and accepts its clarification submission",
    async () => {
      await runWithRetry(
        async () => {
          const agent = buildDelegationAgent();
          const result = (await agent.invoke(
            {
              messages: [
                {
                  role: "user",
                  content: [
                    "Incoming user request: 'Build me a CLI tool.'",
                    "Decide whether this request is ready to execute or needs clarification.",
                  ].join("\n"),
                },
              ],
            },
            { configurable: { thread_id: threadId("clarifier") } },
          )) as AgentInvokeResult;

          const delegated = collectTaskDelegations(result.messages ?? []).map(
            (call) => call.subagent,
          );
          expect(delegated).toContain("clarifier");

          const accepted = collectWorkflowSubmissions(result.messages ?? []).some(
            (submission) =>
              submission.name === "workflow_submit_clarification" &&
              submission.status === "accepted",
          );
          expect(accepted).toBe(true);
        },
        {
          name: "clarifier delegation",
          attempts: LIVE_MAX_ATTEMPTS,
          timeoutMs: LIVE_ATTEMPT_TIMEOUT_MS,
        },
      );
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    "delegates to the reviewer and accepts its review submission",
    async () => {
      await runWithRetry(
        async () => {
          const agent = buildDelegationAgent();
          const result = (await agent.invoke(
            {
              messages: [
                {
                  role: "user",
                  content: [
                    "Complete this request: 'In two sentences, explain what a CLI tool is.'",
                    "Then submit your completed work for review.",
                  ].join("\n"),
                },
              ],
            },
            { configurable: { thread_id: threadId("review") } },
          )) as AgentInvokeResult;

          const delegated = collectTaskDelegations(result.messages ?? []).map(
            (call) => call.subagent,
          );
          expect(delegated).toContain("review-agent");

          const accepted = collectWorkflowSubmissions(result.messages ?? []).some(
            (submission) =>
              submission.name === "workflow_submit_review" && submission.status === "accepted",
          );
          expect(accepted).toBe(true);
        },
        {
          name: "review delegation",
          attempts: LIVE_MAX_ATTEMPTS,
          timeoutMs: LIVE_ATTEMPT_TIMEOUT_MS,
        },
      );
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});
