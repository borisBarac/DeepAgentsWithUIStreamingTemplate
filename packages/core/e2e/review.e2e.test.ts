import { describe, expect, it } from "bun:test";
import { createDefaultSubagentCatalog, createScaffoldedAgent } from "../src/index.ts";
import {
  type AgentInvokeResult,
  createDefaultModelRuntime,
  findToolMessage,
  hasLiveLLMCredentials,
  parseToolMessagePayload,
} from "./helpers.ts";

const REVIEW_PROMPT = [
  "Incoming user request: 'In two sentences, explain what a CLI tool is.'",
  "",
  "Candidate artifact produced by the main agent:",
  '"A CLI tool is a program you run from a terminal. It reads text input and writes text output."',
  "",
  "Use the candidate as the completed execution result, submit it for workflow review, and deliver it if approved.",
].join("\n");

const REVIEW_SUPERVISOR_PROMPT = [
  "You are a deterministic review supervisor for a live e2e test.",
  "Follow workflow controller feedback and submit the supplied candidate with `workflow_complete_execution`.",
  "Then use the `task` tool exactly once with `subagent_type: review-agent`.",
  "Translate the review-agent result into `workflow_submit_review`; its output may be prose or imperfect JSON.",
].join("\n");

const MAX_ATTEMPTS = 2;

describe.skipIf(!hasLiveLLMCredentials)(
  "createRuntimeScaffold reviewer live structured output",
  () => {
    it("accepts the supervisor's schema-enforced review submission", async () => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const modelRuntime = createDefaultModelRuntime(false);
          const reviewer = createDefaultSubagentCatalog({ modelRuntime }).byRole.reviewer;
          if (!reviewer) {
            throw new Error("createDefaultSubagentCatalog did not produce a reviewer subagent.");
          }

          const agent = createScaffoldedAgent({
            modelRuntime,
            guardrails: false,
            systemPrompt: REVIEW_SUPERVISOR_PROMPT,
            subagents: [reviewer],
            reviewOptions: { maxRevisions: 1 },
            triageClassifier: {
              async invoke() {
                return { decision: "skip", reason: "The candidate and review task are complete." };
              },
            },
          });

          const result = (await agent.invoke(
            { messages: [{ role: "user", content: REVIEW_PROMPT }] },
            { configurable: { thread_id: `review-submission-${attempt}` } },
          )) as AgentInvokeResult;

          console.log(`[attempt ${attempt}] result:`, result);

          const submission = parseToolMessagePayload(
            findToolMessage(result.messages, "workflow_submit_review"),
            "workflow_submit_review",
          );
          expect(submission.status).toBe("accepted");
          expect(submission.nextPhase).toBe("delivery_ready");
          return;
        } catch (error) {
          lastError = error;
          console.error(`[attempt ${attempt}] failed:`, error);
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error(`Reviewer e2e failed after ${MAX_ATTEMPTS} attempts`);
    }, 120_000);
  },
);
