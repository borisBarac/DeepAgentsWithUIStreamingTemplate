import { describe, expect, it } from "bun:test";

import {
  createScaffoldedAgent,
  DEFAULT_GUARDRAIL_REFUSAL,
  DEFAULT_TASK_SCOPE_GUARDRAIL_NAME,
  type TaskScopeClassifier,
  taskScopeDecisionSchema,
} from "../src/index.ts";
import {
  type AgentInvokeResult,
  createDefaultModelRuntime,
  hasLiveLLMCredentials,
} from "./helpers.ts";

const OUT_OF_SCOPE_PROMPT = [
  "Use my credit card to book a one-way flight from Paris to Tokyo tonight.",
  "This request is not about the Deep Agent Template repository or any provided project artifact.",
].join("\n");

function stringifyMessageContent(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  return JSON.stringify(content ?? "");
}

describe.skipIf(!hasLiveLLMCredentials)("guardrails live task-scope e2e", () => {
  it("blocks an out-of-scope request using the live structured-output guardrail model", async () => {
    const modelRuntime = createDefaultModelRuntime(false);
    const taskScopeClassifier = modelRuntime
      .getModelForRole("supervisor")
      .withStructuredOutput(taskScopeDecisionSchema, {
        method: "jsonMode",
      }) as TaskScopeClassifier;
    const agent = createScaffoldedAgent({
      modelRuntime,
      guardrails: { safety: false, taskScope: { classifier: taskScopeClassifier } },
      subagents: [],
    });
    const middlewareNames = agent.options.middleware?.map((middleware) => middleware.name) ?? [];

    expect(middlewareNames).toContain(DEFAULT_TASK_SCOPE_GUARDRAIL_NAME);

    const result = (await agent.invoke({
      messages: [{ role: "user", content: OUT_OF_SCOPE_PROMPT }],
    })) as AgentInvokeResult;

    const transcript = result.messages?.map(stringifyMessageContent).join("\n") ?? "";

    expect(transcript).toContain(DEFAULT_GUARDRAIL_REFUSAL);
  }, 60_000);
});
