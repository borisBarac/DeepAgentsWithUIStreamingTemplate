import { describe, expect, it } from "bun:test";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { InMemoryStore } from "@langchain/langgraph";

import { createWorkflowControllerMiddleware, WorkflowRuntimeError } from "./runtime.ts";

const options = {
  maxClarificationRounds: 1,
  questionsPerRound: 3 as const,
  maxRevisions: 2,
  generativeUiEnabled: true,
};

type Hook = (state: unknown, runtime: unknown) => Promise<Record<string, unknown> | undefined>;

function request(threadId: string, subagent: string, content: unknown) {
  return {
    toolCall: {
      id: `${threadId}-${subagent}`,
      name: "task",
      args: { description: "Do it", subagent_type: subagent },
    },
    runtime: { configurable: { thread_id: threadId } },
    state: {},
    tool: undefined,
    handler: async () =>
      new ToolMessage({ content: JSON.stringify(content), tool_call_id: `${threadId}-call` }),
  };
}

describe("workflow controller middleware", () => {
  it("rejects narration and requires clarification first", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build a kanban board")] } as never,
      { configurable: { thread_id: "a" } } as never,
    );
    const afterModel = middleware.afterModel as { hook: Hook };
    const update = (await afterModel.hook(
      { messages: [new AIMessage("I will begin.")] },
      { configurable: { thread_id: "a" } },
    )) as { jumpTo?: unknown; messages: HumanMessage[] };

    expect(update.jumpTo).toBe("model");
    expect(String(update.messages[0]?.content)).toContain("clarifier");
  });

  it("continues readiness through execution, product generation, and review", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build a kanban board")] } as never,
      { configurable: { thread_id: "flow" } } as never,
    );
    const clarification = request("flow", "clarifier", {
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      missingInformation: [],
      answeredInformation: [],
      reasoningSummary: "Proceed.",
      roundCount: 1,
      maxRounds: 1,
    });
    await middleware.wrapToolCall?.(clarification as never, clarification.handler as never);
    expect(middleware.getWorkflowState("flow")?.phase).toBe("execution");

    const complete = {
      toolCall: {
        id: "complete",
        name: "workflow_complete_execution",
        args: {
          candidateFinalResponse: "Done",
          deliverables: ["Layout"],
          validationEvidence: ["Checked"],
          assumptions: ["5-10 people"],
        },
      },
      runtime: { configurable: { thread_id: "flow" } },
      state: {},
      tool: undefined,
    };
    await middleware.wrapToolCall?.(
      complete as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "complete" })) as never,
    );
    expect(middleware.getWorkflowState("flow")?.phase).toBe("product_generation");

    const product = request("flow", "product-generator", {
      products: [{ id: "board", title: "Kanban board", description: "Four columns" }],
    });
    await middleware.wrapToolCall?.(product as never, product.handler as never);
    expect(middleware.getWorkflowState("flow")?.phase).toBe("review");

    const review = request("flow", "review-agent", {
      status: "approved",
      score: 95,
      criticalIssues: [],
      majorIssues: [],
      minorIssues: [],
      requiredChanges: [],
      finalRecommendation: "Deliver",
    });
    await middleware.wrapToolCall?.(review as never, review.handler as never);
    expect(middleware.getWorkflowState("flow")?.phase).toBe("delivery_ready");
  });

  it("restores workflow state from the store without leaking between threads", async () => {
    const store = new InMemoryStore();
    const first = createWorkflowControllerMiddleware(options);
    const beforeFirst = first.beforeAgent as Hook;
    await beforeFirst(
      { messages: [new HumanMessage("Request A")] },
      { configurable: { thread_id: "a" }, store },
    );

    const second = createWorkflowControllerMiddleware(options);
    const beforeSecond = second.beforeAgent as Hook;
    await beforeSecond(
      { messages: [new HumanMessage("Request A")] },
      { configurable: { thread_id: "a" }, store },
    );
    await beforeSecond(
      { messages: [new HumanMessage("Request B")] },
      { configurable: { thread_id: "b" }, store },
    );

    expect(second.getWorkflowState("a")?.originalRequest).toBe("Request A");
    expect(second.getWorkflowState("b")?.originalRequest).toBe("Request B");
  });

  it("fails after a subagent repeatedly returns malformed output", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build something")] } as never,
      { configurable: { thread_id: "bad" } } as never,
    );

    const bad = request("bad", "clarifier", { invalidShape: true });
    const call = () =>
      middleware.wrapToolCall?.(bad as never, bad.handler as never) as Promise<unknown>;

    // Three malformed outputs are tolerated (error toolMessage returned to the model).
    await call();
    await call();
    await call();
    expect(middleware.getWorkflowState("bad")?.phase).toBe("clarification");

    // The fourth consecutive malformed output exceeds the limit and fails hard.
    await expect(call()).rejects.toBeInstanceOf(WorkflowRuntimeError);
    const failed = middleware.getWorkflowState("bad");
    expect(failed?.phase).toBe("error");
    expect(failed?.terminalError?.code).toBe("malformed_output_limit_exceeded");
  });
});
