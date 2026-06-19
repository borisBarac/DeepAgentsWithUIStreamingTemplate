import { describe, expect, it } from "bun:test";

import { createClarificationState } from "../clarification/index.ts";
import type { OrchestratedDeepAgentMessage, OrchestratedDeepAgentState } from "./index.ts";
import { createOrchestratedDeepAgentGraph } from "./index.ts";
import {
  APPROVED_REVIEW,
  createFailingAgent,
  createMockAgent,
  createReviewAgent,
  invokeInput,
  NO_CLARIFICATION,
  runtimeWithoutRoleAssignments,
} from "./test-helpers.ts";

describe("createOrchestratedDeepAgentGraph custom agent injection", () => {
  it("invokes an injected researcher and flows output to the finalizer", async () => {
    const { agent: researcher, calls } = createMockAgent("Redis streams are append-only logs.");
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: true, enableCoding: false },
      agents: { researcher, reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(
      invokeInput("Research Redis streams"),
    )) as OrchestratedDeepAgentState;

    expect(calls.length).toBe(1);
    expect(result.researchResult).toBe("Redis streams are append-only logs.");
    expect(result.finalAnswer).toContain("Redis streams are append-only logs.");
    expect(result.next).toBe("end");
  });

  it("supplies conversation history and answered clarifications to the researcher", async () => {
    const researcher = createMockAgent("research complete");
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const clarification = {
      ...createClarificationState("Research Redis streams"),
      answeredInformation: [{ key: "runtime", value: "Node.js" }],
      status: "ready_to_proceed" as const,
      readyToProceed: true,
    };
    const messages: OrchestratedDeepAgentMessage[] = [
      { role: "user", content: "We deploy on Kubernetes." },
      { role: "assistant", content: "Understood." },
    ];
    const graph = createOrchestratedDeepAgentGraph({
      routing: { enableResearch: true, enableCoding: false },
      agents: { researcher: researcher.agent, reviewer: reviewer.agent },
    });

    await graph.invoke(invokeInput("Research Redis streams", { clarification, messages }));

    expect(researcher.calls[0]?.messages).toEqual(
      expect.arrayContaining([
        { role: "user", content: "We deploy on Kubernetes." },
        { role: "assistant", content: "Understood." },
        { role: "system", content: "Clarifications provided:\n- runtime: Node.js" },
      ]),
    );
  });

  it("keeps injected agents ahead of runtime role resolution", async () => {
    const researcher = createMockAgent("research complete");
    const finalizer = createMockAgent("final answer");
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      modelRuntime: runtimeWithoutRoleAssignments(),
      routing: { enableResearch: true, enableCoding: false },
      agents: {
        researcher: researcher.agent,
        finalizer: finalizer.agent,
        reviewer: reviewer.agent,
      },
    });

    const result = (await graph.invoke(
      invokeInput("Research Redis streams"),
    )) as OrchestratedDeepAgentState;

    expect(result.finalAnswer).toBe("final answer");
  });
});

describe("createOrchestratedDeepAgentGraph model runtime roles", () => {
  it.each([
    {
      role: "researcher",
      task: "Research Redis streams",
      routing: { enableResearch: true, enableCoding: false },
      agents: {},
    },
    {
      role: "coder",
      task: "Implement a consumer",
      routing: { enableResearch: false, enableCoding: true },
      agents: {},
    },
    {
      role: "finalizer",
      task: "hello",
      routing: { enableResearch: false, enableCoding: false },
      agents: {},
    },
    {
      role: "reviewer",
      task: "hello",
      routing: { enableResearch: false, enableCoding: false },
      agents: { finalizer: createMockAgent("answer").agent },
    },
  ])("resolves the $role assignment for its generated stage agent", async (testCase) => {
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      modelRuntime: runtimeWithoutRoleAssignments(),
      routing: testCase.routing,
      agents: testCase.agents,
    });

    await expect(graph.invoke(invokeInput(testCase.task))).rejects.toThrow(
      `No model assignment configured for role "${testCase.role}"`,
    );
  });
});

describe("createOrchestratedDeepAgentGraph error propagation", () => {
  it("records a structured error and still finalizes when an optional stage fails", async () => {
    const { agent: researcher } = createFailingAgent(new Error("model rate limit 429"));
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: true, enableCoding: false },
      agents: { researcher, reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(
      invokeInput("Research Redis streams"),
    )) as OrchestratedDeepAgentState;

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]?.node).toBe("researcher");
    expect(result.errors[0]?.category).toBe("model");
    expect(result.next).toBe("end");
    expect(result.finalAnswer).toContain("## Caveats");
  });

  it("routes a code task through the coder node", async () => {
    const coder = createMockAgent("implementation plan");
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: true },
      agents: { coder: coder.agent, reviewer: reviewer.agent },
    });

    const result = (await graph.invoke(
      invokeInput("Implement a consumer"),
    )) as OrchestratedDeepAgentState;

    expect(coder.calls.length).toBe(1);
    expect(result.codeResult).toBe("implementation plan");
    expect(result.finalAnswer).toContain("implementation plan");
  });

  it("supplies prior research and known errors to the coder", async () => {
    const coder = createMockAgent("implementation plan");
    const reviewer = createReviewAgent(APPROVED_REVIEW);
    const graph = createOrchestratedDeepAgentGraph({
      ...NO_CLARIFICATION,
      routing: { enableResearch: false, enableCoding: true },
      agents: { coder: coder.agent, reviewer: reviewer.agent },
    });

    await graph.invoke(
      invokeInput("Implement a consumer", {
        researchResult: "Redis streams require consumer groups.",
        errors: [
          {
            node: "researcher",
            category: "tool",
            message: "One source timed out",
            retryCount: 1,
            required: false,
          },
        ],
      }),
    );

    expect(coder.calls[0]?.messages).toEqual(
      expect.arrayContaining([
        {
          role: "system",
          content: "Prior research:\nRedis streams require consumer groups.",
        },
        {
          role: "system",
          content: "Known limitations:\n- [tool] researcher: One source timed out",
        },
      ]),
    );
  });
});
