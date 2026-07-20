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
  LIVE_TEST_TIMEOUT_MS,
  parseToolMessagePayload,
  runLiveScenario,
} from "./helpers.ts";

const CLARIFIER_PROMPT = [
  "Incoming user request: 'Build me a CLI tool.'",
  "Decide whether this request is ready to execute or needs clarification.",
].join("\n");

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

describe.skipIf(!hasLiveLLMCredentials)(
  "createRuntimeScaffold clarifier live structured output",
  () => {
    it(
      "accepts the supervisor's schema-enforced clarification submission",
      async () => {
        await runLiveScenario(
          async ({ threadId }) => {
            const agent = buildClarifierAgent();
            const result = (await agent.invoke(
              {
                messages: [{ role: "user", content: CLARIFIER_PROMPT }],
              },
              {
                configurable: { thread_id: threadId },
              },
            )) as AgentInvokeResult;

            const submission = parseToolMessagePayload(
              findToolMessage(result.messages, "workflow_submit_clarification"),
              "workflow_submit_clarification",
            );
            if (submission.status !== "accepted") {
              throw new Error(
                `Clarification submission was not accepted (status=${String(submission.status)}).`,
              );
            }

            const parsed = clarificationResultSchema.parse(submission.result);

            expect(["waiting_for_user", "execution"]).toContain(submission.nextPhase as string);
            expect(["needs_clarification", "ready_to_proceed", "blocked"]).toContain(parsed.status);

            return {
              value: { submission, parsed },
              collect: () => {},
            };
          },
          { scenarioName: "clarifier live structured output", threadPrefix: "clarifier" },
        );
      },
      LIVE_TEST_TIMEOUT_MS,
    );
  },
);
