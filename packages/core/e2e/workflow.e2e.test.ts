import { describe, expect, it } from "bun:test";

import { createScaffoldedAgent } from "../src/index.ts";
import {
  type AgentInvokeResult,
  createDefaultModelRuntime,
  hasLiveLLMCredentials,
} from "./helpers.ts";

const WORKFLOW_PROMPT = [
  "Write a two-sentence definition of a command-line interface (CLI) tool.",
  "Include one example of a common CLI tool.",
].join("\n");

function isMessageRecord(message: unknown): message is Record<string, unknown> {
  return typeof message === "object" && message !== null;
}

function stringifyMessageContent(message: unknown): string {
  if (!isMessageRecord(message)) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  return JSON.stringify(content ?? "");
}

function transcriptOf(messages: unknown[] | undefined): string {
  return messages?.map(stringifyMessageContent).join("\n") ?? "";
}

function taskDelegations(messages: unknown[] | undefined): string[] {
  if (!messages) return [];
  const types: string[] = [];
  for (const message of messages) {
    if (!isMessageRecord(message)) continue;
    const toolCalls = message.tool_calls;
    if (!Array.isArray(toolCalls)) continue;
    for (const call of toolCalls) {
      if (!isMessageRecord(call) || call.name !== "task" || !isMessageRecord(call.args)) continue;
      const args = call.args;
      if (typeof args.subagent_type === "string") {
        types.push(args.subagent_type);
      }
    }
  }
  return types;
}

function finalDeliverableText(messages: unknown[] | undefined): string {
  if (!messages) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isMessageRecord(message)) continue;
    if (typeof message.tool_call_id === "string") continue;
    return stringifyMessageContent(message);
  }
  return "";
}

describe.skipIf(!hasLiveLLMCredentials)(
  "workflow controller live happy path through scaffolded agent",
  () => {
    it("forces clarifier, product-generator, and review-agent delegations in order before delivery", async () => {
      const modelRuntime = createDefaultModelRuntime(false);
      const agent = createScaffoldedAgent({
        modelRuntime,
        guardrails: false,
        generativeUi: {},
      });

      const result = (await agent.invoke(
        { messages: [{ role: "user", content: WORKFLOW_PROMPT }] },
        { configurable: { thread_id: "workflow-happy-path" } },
      )) as AgentInvokeResult;

      console.log(result);

      const transcript = transcriptOf(result.messages);

      expect(transcript).toContain("WORKFLOW_CONTROLLER_FEEDBACK");

      const delegations = taskDelegations(result.messages);
      const clarifierIndex = delegations.indexOf("clarifier");
      const productGeneratorIndex = delegations.indexOf("product-generator");
      const reviewAgentIndex = delegations.indexOf("review-agent");
      expect(clarifierIndex).toBeGreaterThanOrEqual(0);
      expect(productGeneratorIndex).toBeGreaterThan(clarifierIndex);
      expect(reviewAgentIndex).toBeGreaterThan(productGeneratorIndex);

      expect(transcript).not.toContain("phase=error");
      expect(transcript).not.toContain("controller_retry_exhausted");

      const deliverable = finalDeliverableText(result.messages);
      expect(deliverable.length).toBeGreaterThan(0);
      expect(deliverable.startsWith("WORKFLOW_CONTROLLER_FEEDBACK")).toBe(false);
    }, 180_000);
  },
);
