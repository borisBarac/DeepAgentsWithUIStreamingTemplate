import { describe, expect, it } from "bun:test";
import {
  clarificationResultSchema,
  createRuntimeScaffold,
  createScaffoldedAgent,
} from "../src/index.ts";
import { createDefaultSubagents } from "../src/scaffold/subagents.ts";
import {
  createDefaultModelRuntime,
  findTaskToolMessage,
  hasLiveLLMCredentials,
  parseTaskToolPayload,
  type AgentInvokeResult,
} from "./helpers.ts";

const CLARIFIER_PROMPT = [
  "Incoming user request: 'Build me a CLI tool.'",
  "Decide whether this request is ready to execute or needs clarification.",
].join("\n");

describe.skipIf(!hasLiveLLMCredentials)(
  "createRuntimeScaffold clarifier live structured output",
  () => {
    it("surfaces the clarifier structured response when the supervisor delegates through the scaffolded agent", async () => {
      const modelRuntime = createDefaultModelRuntime(false);
      const [clarifier] = createDefaultSubagents({ modelRuntime });
      if (!clarifier) {
        throw new Error("createDefaultSubagents did not produce a clarifier subagent.");
      }

      const scaffold = createRuntimeScaffold({
        modelRuntime: createDefaultModelRuntime(true),
        subagents: [clarifier],
      });
      if (scaffold.subagents.length !== 1) {
        throw new Error("createRuntimeScaffold did not surface exactly one subagent.");
      }

      const agent = createScaffoldedAgent({
        modelRuntime,
        guardrails: false,
        subagents: scaffold.subagents,
      });

      const result = (await agent.invoke({
        messages: [{ role: "user", content: CLARIFIER_PROMPT }],
      })) as AgentInvokeResult;

      console.log(result);

      const payload = parseTaskToolPayload(findTaskToolMessage(result.messages));

      expect(() => clarificationResultSchema.parse(payload)).not.toThrow();
      expect(["needs_clarification", "ready_to_proceed", "blocked"]).toContain(
        payload.status as string,
      );
    }, 60_000);
  },
);
