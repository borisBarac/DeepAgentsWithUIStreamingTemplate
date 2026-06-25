import { describe, expect, it } from "bun:test";
import type { SubAgent } from "deepagents";

import {
  createRuntimeScaffold,
  createScaffoldedAgent,
  productCardBatchSchema,
} from "../src/index.ts";
import { createDefaultSubagents } from "../src/scaffold/subagents.ts";
import {
  type AgentInvokeResult,
  createDefaultModelRuntime,
  findTaskToolMessage,
  hasLiveLLMCredentials,
  parseTaskToolPayload,
} from "./helpers.ts";

const PRODUCT_PROMPT = [
  "Generate a batch of 2 product cards for a wireless noise-cancelling headphone product line.",
  "Delegate this to your product-generator subagent and relay its product cards.",
].join("\n");

describe.skipIf(!hasLiveLLMCredentials)(
  "createRuntimeScaffold product-generator live structured output",
  () => {
    it("surfaces a productCardBatch-spec-compliant response from the product-generator", async () => {
      const modelRuntime = createDefaultModelRuntime(false);
      const productGenerator = createDefaultSubagents({
        modelRuntime,
        generativeUi: {},
      }).find((subagent) => subagent.name === "product-generator");
      if (!productGenerator) {
        throw new Error("createDefaultSubagents did not produce a product-generator subagent.");
      }

      const scaffold = createRuntimeScaffold({
        modelRuntime,
        generativeUi: {},
        subagents: [productGenerator as SubAgent],
      });
      if (scaffold.subagents.length !== 1) {
        throw new Error("createRuntimeScaffold did not surface exactly one subagent.");
      }

      expect(JSON.stringify(scaffold.systemPrompt)).toContain("newline-delimited JSON");
      expect(JSON.stringify(scaffold.systemPrompt)).toContain("product-card");

      const agent = createScaffoldedAgent({
        modelRuntime,
        guardrails: false,
        subagents: scaffold.subagents,
      });

      const result = (await agent.invoke({
        messages: [{ role: "user", content: PRODUCT_PROMPT }],
      })) as AgentInvokeResult;

      console.log(result);

      const payload = parseTaskToolPayload(findTaskToolMessage(result.messages));

      const batch = productCardBatchSchema.parse(payload);
      expect(batch.products.length).toBeGreaterThanOrEqual(1);
      for (const product of batch.products) {
        expect(product.id.length).toBeGreaterThan(0);
        expect(product.title.length).toBeGreaterThan(0);
        expect(product.description.length).toBeGreaterThan(0);
      }
    }, 60_000);
  },
);
