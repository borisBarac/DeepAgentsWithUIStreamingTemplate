import { describe, expect, it } from "bun:test";
import {
  createDefaultSubagentCatalog,
  createRuntimeScaffold,
  createScaffoldedAgent,
  reviewReportSchema,
} from "../src/index.ts";
import {
  type AgentInvokeResult,
  createDefaultModelRuntime,
  findTaskToolMessage,
  hasLiveLLMCredentials,
  parseTaskToolPayload,
} from "./helpers.ts";

const REVIEW_PROMPT = [
  "Incoming user request: 'In two sentences, explain what a CLI tool is.'",
  "",
  "Candidate artifact produced by the main agent:",
  '"A CLI tool is a program you run from a terminal. It reads text input and writes text output."',
  "",
  "Submit this candidate to your review subagent and relay the structured review report unchanged.",
].join("\n");

describe.skipIf(!hasLiveLLMCredentials)(
  "createRuntimeScaffold reviewer live structured output",
  () => {
    it("surfaces the reviewer structured report when the supervisor delegates through the scaffolded agent", async () => {
      const modelRuntime = createDefaultModelRuntime(false);
      const reviewer = createDefaultSubagentCatalog({ modelRuntime }).byRole.reviewer;
      if (!reviewer) {
        throw new Error("createDefaultSubagentCatalog did not produce a reviewer subagent.");
      }

      const scaffold = createRuntimeScaffold({
        modelRuntime,
        subagents: [reviewer],
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
        messages: [{ role: "user", content: REVIEW_PROMPT }],
      })) as AgentInvokeResult;

      console.log(result);

      const payload = parseTaskToolPayload(findTaskToolMessage(result.messages));

      expect(() => reviewReportSchema.parse(payload)).not.toThrow();
      expect(["approved", "changes_required", "blocked"]).toContain(payload.status as string);
      expect(typeof payload.score).toBe("number");
      expect(payload.score as number).toBeGreaterThanOrEqual(0);
      expect(payload.score as number).toBeLessThanOrEqual(100);
    }, 60_000);
  },
);
