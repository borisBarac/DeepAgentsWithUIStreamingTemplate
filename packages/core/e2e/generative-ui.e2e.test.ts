import { describe, expect, it } from "bun:test";
import { InMemoryStore } from "@langchain/langgraph";
import type { SubAgent } from "deepagents";
import { createAgentFromRuntimeScaffold } from "../src/agent/runtime.ts";
import {
  createDefaultSubagentCatalog,
  createRuntimeScaffold,
  productCardBatchSchema,
} from "../src/index.ts";
import {
  type AgentInvokeResult,
  createDefaultModelRuntime,
  findTaskToolMessage,
  hasLiveLLMCredentials,
  parseTaskToolPayload,
} from "./helpers.ts";

const PRODUCT_PROMPT = [
  "Incoming user request: 'Show me product cards for two of our headphones.'",
  "",
  "The request is already clarified and ready to proceed. Generate cards for these two products:",
  "1. 'Aurora NC Pro' — premium over-ear audiophile headphones with adaptive ANC, $349.",
  "2. 'Aurora NC Lite' — everyday over-ear headphones with hybrid ANC, $149.",
  "",
  "Delegate this to your product-generator subagent and relay its product cards.",
].join("\n");

const PRODUCT_SUPERVISOR_PROMPT = [
  "You are a deterministic product-generator supervisor for a live e2e test.",
  "The user request is already clarified.",
  "Use the `task` tool exactly once with `subagent_type: product-generator`.",
  "Relay the product-generator result unchanged.",
].join("\n");

describe.skipIf(!hasLiveLLMCredentials)(
  "createRuntimeScaffold product-generator live structured output",
  () => {
    it("surfaces a productCardBatch-spec-compliant response from the product-generator", async () => {
      const modelRuntime = createDefaultModelRuntime(false);
      const productGenerator = createDefaultSubagentCatalog({
        modelRuntime,
        generativeUi: {},
      }).byRole["product-generator"];
      if (!productGenerator) {
        throw new Error(
          "createDefaultSubagentCatalog did not produce a product-generator subagent.",
        );
      }

      const scaffold = createRuntimeScaffold({
        modelRuntime,
        generativeUi: {},
        systemPrompt: PRODUCT_SUPERVISOR_PROMPT,
        subagents: [productGenerator as SubAgent],
      });
      if (scaffold.subagents.length !== 1) {
        throw new Error("createRuntimeScaffold did not surface exactly one subagent.");
      }

      expect(JSON.stringify(scaffold.systemPrompt)).toContain("Return one JSON object");
      expect(JSON.stringify(scaffold.systemPrompt)).toContain("product-card");

      const agent = createAgentFromRuntimeScaffold({
        factoryName: "createScaffoldedAgent",
        scaffold,
        modelRuntime,
        guardrails: false,
        store: new InMemoryStore(),
      });

      const result = (await agent.invoke({
        messages: [{ role: "user", content: PRODUCT_PROMPT }],
      })) as AgentInvokeResult;

      const payload = parseTaskToolPayload(findTaskToolMessage(result.messages));

      const batch = productCardBatchSchema.parse(payload);
      expect(batch.products.length).toBeGreaterThanOrEqual(1);
      for (const product of batch.products) {
        expect(product.id.length).toBeGreaterThan(0);
        expect(product.title.length).toBeGreaterThan(0);
        expect(product.description.length).toBeGreaterThan(0);
      }
    }, 120_000);
  },
);
