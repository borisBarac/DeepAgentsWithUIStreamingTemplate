import { describe, expect, it } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import type { DeepAgent } from "deepagents";

import { createProductGateAgent } from "./product-gate.ts";

function fakeAgent(label: string, calls: string[]): DeepAgent {
  return {
    invoke: async () => {
      calls.push(label);
      return { messages: [] };
    },
    streamEvents: async () => {
      calls.push(label);
      return { output: Promise.resolve({ messages: [] }) };
    },
  } as never;
}

function classifierModel(route: "casual" | "product", calls: string[]) {
  return {
    withStructuredOutput: () => ({
      invoke: async () => {
        calls.push("classifier");
        return { route };
      },
    }),
  } as never;
}

describe("product gate", () => {
  it("routes a pre-product greeting to the casual agent", async () => {
    const calls: string[] = [];
    const agent = createProductGateAgent({
      mainAgent: fakeAgent("main", calls),
      casualAgent: fakeAgent("casual", calls),
      casualModel: {} as never,
      classifierModel: classifierModel("casual", calls),
    });

    await agent.invoke({ messages: [new HumanMessage("Hi, how are you?")] });

    expect(calls).toEqual(["classifier", "casual"]);
  });

  it("routes a product request to the main agent", async () => {
    const calls: string[] = [];
    const agent = createProductGateAgent({
      mainAgent: fakeAgent("main", calls),
      casualAgent: fakeAgent("casual", calls),
      casualModel: {} as never,
      classifierModel: classifierModel("product", calls),
    });

    await agent.invoke({ messages: [new HumanMessage("Create a shoe collection")] });

    expect(calls).toEqual(["classifier", "main"]);
  });

  it("always uses the main agent after workflow state exists", async () => {
    const calls: string[] = [];
    const agent = createProductGateAgent({
      mainAgent: fakeAgent("main", calls),
      casualAgent: fakeAgent("casual", calls),
      casualModel: {} as never,
      classifierModel: classifierModel("casual", calls),
      workflowController: { hasWorkflowState: async () => true },
    });

    await agent.streamEvents(
      { messages: [new HumanMessage("Hi")] },
      { configurable: { thread_id: "active" }, version: "v3" },
    );

    expect(calls).toEqual(["main"]);
  });

  it("always uses the main agent when message history contains products", async () => {
    const calls: string[] = [];
    const productOutput = JSON.stringify({
      version: 1,
      updates: [
        {
          type: "ui",
          rootId: "products",
          components: [
            { id: "products", component: "ProductGrid", children: ["shoe"] },
            { id: "shoe", component: "ProductCard", title: "Shoe", description: "A shoe" },
          ],
        },
      ],
    });
    const agent = createProductGateAgent({
      mainAgent: fakeAgent("main", calls),
      casualAgent: fakeAgent("casual", calls),
      casualModel: {} as never,
      classifierModel: classifierModel("casual", calls),
    });

    await agent.invoke({
      messages: [{ role: "assistant", content: productOutput }, new HumanMessage("Hi")],
    });

    expect(calls).toEqual(["main"]);
  });
});
