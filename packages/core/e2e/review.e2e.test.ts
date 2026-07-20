import { describe, expect, it } from "bun:test";
import { createDefaultSubagentCatalog, createScaffoldedAgent } from "../src/index.ts";
import {
  type AgentInvokeResult,
  createDefaultModelRuntime,
  findToolMessage,
  hasLiveLLMCredentials,
  LIVE_TEST_TIMEOUT_MS,
  parseToolMessagePayload,
  runLiveScenario,
} from "./helpers.ts";

const REVIEW_PROMPT = [
  "Incoming user request: 'In two sentences, explain what a CLI tool is.'",
  "",
  "Candidate artifact produced by the main agent:",
  '"A CLI tool is a program you run from a terminal. It reads text input and writes text output."',
  "",
  "Use the candidate as the completed execution result, submit it for workflow review, and deliver it if approved.",
].join("\n");

/**
 * Live e2e test directive layered on the default supervisor prompt. We rely on
 * the workflow controller to drive the supervisor through the canonical phases
 * (clarify → execute → review → deliver). The directive pins deterministic
 * translation choices so the model does not invent new transitions.
 */
const REVIEW_SUPERVISOR_PROMPT = [
  "You are a deterministic product design system supervisor for a live e2e test.",
  "",
  "Phase behavior:",
  "- Clarification phase: call the `task` tool once with `subagent_type: clarifier`. Translate its result into `workflow_submit_clarification` with `status: ready_to_proceed` and `requestKind: products`.",
  "- Execution phase: call `workflow_complete_execution` with the candidate artifact as `candidateFinalResponse` and one deliverable.",
  "- Review phase: call the `task` tool once with `subagent_type: review-agent`. Translate its result into `workflow_submit_review`.",
  "- Delivery phase: stop. The host renders the final presentation.",
  "",
  "Do not narrate. Do not skip phases. Do not call any tool that the controller has not asked for.",
].join("\n");

describe.skipIf(!hasLiveLLMCredentials)(
  "createRuntimeScaffold reviewer live structured output",
  () => {
    it(
      "accepts the supervisor's schema-enforced review submission",
      async () => {
        await runLiveScenario(
          async ({ threadId }) => {
            const modelRuntime = createDefaultModelRuntime(false);
            const catalog = createDefaultSubagentCatalog({ modelRuntime });
            const clarifier = catalog.byRole.clarifier;
            const reviewer = catalog.byRole.reviewer;
            if (!clarifier) {
              throw new Error("createDefaultSubagentCatalog did not produce a clarifier subagent.");
            }
            if (!reviewer) {
              throw new Error("createDefaultSubagentCatalog did not produce a reviewer subagent.");
            }

            const agent = createScaffoldedAgent({
              modelRuntime,
              guardrails: false,
              systemPrompt: REVIEW_SUPERVISOR_PROMPT,
              subagents: [clarifier, reviewer],
              reviewOptions: { maxReviewCycles: 1 },
            });

            const result = (await agent.invoke(
              { messages: [{ role: "user", content: REVIEW_PROMPT }] },
              { configurable: { thread_id: threadId } },
            )) as AgentInvokeResult;

            const submission = parseToolMessagePayload(
              findToolMessage(result.messages, "workflow_submit_review"),
              "workflow_submit_review",
            );
            expect(submission.status).toBe("accepted");
            expect(submission.nextPhase).toBe("delivery_ready");

            return { value: submission, collect: () => {} };
          },
          { scenarioName: "reviewer live structured output", threadPrefix: "reviewer" },
        );
      },
      LIVE_TEST_TIMEOUT_MS,
    );
  },
);
