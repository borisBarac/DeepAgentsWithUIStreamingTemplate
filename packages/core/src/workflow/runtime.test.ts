import { describe, expect, it } from "bun:test";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { InMemoryStore } from "@langchain/langgraph";

import {
  createWorkflowControllerMiddleware,
  workflowCompleteExecutionTool,
  workflowSubmitClarificationTool,
  workflowSubmitProductsTool,
  workflowSubmitReviewTool,
} from "./runtime.ts";

const options = {
  maxClarificationRounds: 1,
  questionsPerRound: 3 as const,
  maxReviewCycles: 2,
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

function rawRequest(threadId: string, subagent: string, content: string) {
  return {
    toolCall: {
      id: `${threadId}-${subagent}`,
      name: "task",
      args: { description: "Do it", subagent_type: subagent },
    },
    runtime: { configurable: { thread_id: threadId } },
    state: {},
    tool: undefined,
    handler: async () => new ToolMessage({ content, tool_call_id: `${threadId}-call` }),
  };
}

function submission(threadId: string, name: string, args: Record<string, unknown>) {
  return {
    toolCall: { id: `${threadId}-${name}`, name, args },
    runtime: { configurable: { thread_id: threadId } },
    state: {},
    tool: undefined,
  };
}

describe("workflow controller middleware", () => {
  it("registers four typed submission tools that reject invalid arguments", async () => {
    expect([
      workflowSubmitClarificationTool.name,
      workflowCompleteExecutionTool.name,
      workflowSubmitProductsTool.name,
      workflowSubmitReviewTool.name,
    ]).toEqual([
      "workflow_submit_clarification",
      "workflow_complete_execution",
      "workflow_submit_products",
      "workflow_submit_review",
    ]);
    for (const workflowTool of [
      workflowSubmitClarificationTool,
      workflowCompleteExecutionTool,
      workflowSubmitProductsTool,
      workflowSubmitReviewTool,
    ]) {
      await expect(
        (workflowTool as { invoke(input: unknown): Promise<unknown> }).invoke({ invalid: true }),
      ).rejects.toBeDefined();
    }
  });

  it("requires product generation before review and preserves update root and count", async () => {
    const middleware = createWorkflowControllerMiddleware({
      ...options,
      productGenerationEnabled: true,
    });
    const beforeAgent = middleware.beforeAgent as Hook;
    const previous = {
      version: 1,
      updates: [
        {
          type: "ui",
          rootId: "catalog",
          components: [
            { id: "catalog", component: "ProductGrid", children: ["old-1", "old-2"] },
            { id: "old-1", component: "ProductCard", title: "Old 1", description: "Old" },
            { id: "old-2", component: "ProductCard", title: "Old 2", description: "Old" },
          ],
        },
      ],
    };
    await beforeAgent(
      {
        messages: [
          { role: "assistant", content: JSON.stringify(previous) },
          new HumanMessage("Make the products brighter"),
        ],
      },
      { configurable: { thread_id: "products" } },
    );
    const clarification = request("products", "clarifier", "REQUEST_KIND: products");
    await middleware.wrapToolCall?.(clarification as never, clarification.handler as never);
    await middleware.wrapToolCall?.(
      submission("products", "workflow_submit_clarification", {
        requestKind: "products",
        status: "ready_to_proceed",
        readyToProceed: true,
        questions: [],
        missingInformation: [],
        answeredInformation: [],
        reasoningSummary: "Ready.",
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "c" })) as never,
    );
    await middleware.wrapToolCall?.(
      submission("products", "workflow_complete_execution", {
        candidateFinalResponse: "Updated",
        deliverables: ["Products"],
        validationEvidence: [],
        assumptions: [],
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "e" })) as never,
    );
    expect(middleware.getWorkflowState("products")).toMatchObject({
      phase: "product_generation",
      productMode: "update",
      targetProductCount: 2,
    });

    const premature = (await middleware.wrapToolCall?.(
      submission("products", "workflow_submit_review", {}) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "r" })) as never,
    )) as ToolMessage;
    expect(String(premature.content)).toContain("invalid_workflow_phase");

    const generator = request("products", "product-generator", "MODE: update");
    await middleware.wrapToolCall?.(generator as never, generator.handler as never);
    const products = [
      { id: "new-1", title: "Bright 1", description: "New" },
      { id: "new-2", title: "Bright 2", description: "New" },
    ];
    await middleware.wrapToolCall?.(
      submission("products", "workflow_submit_products", {
        mode: "update",
        gridRoot: "catalog",
        products,
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "p" })) as never,
    );
    expect(middleware.getWorkflowState("products")).toMatchObject({
      phase: "review",
      generatedProducts: { mode: "update", gridRoot: "catalog", products },
    });
  });

  it("rejects JSON-shaped product-generator replies and requires prose", async () => {
    const middleware = createWorkflowControllerMiddleware({
      ...options,
      productGenerationEnabled: true,
    });
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      {
        messages: [
          { role: "user", content: "Create 2 products" },
          new HumanMessage("Create 2 products"),
        ],
      },
      { configurable: { thread_id: "products-json" } },
    );
    await middleware.wrapToolCall?.(
      request("products-json", "clarifier", "REQUEST_KIND: products") as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "c" })) as never,
    );
    await middleware.wrapToolCall?.(
      submission("products-json", "workflow_submit_clarification", {
        requestKind: "products",
        status: "ready_to_proceed",
        readyToProceed: true,
        questions: [],
        missingInformation: [],
        answeredInformation: [],
        reasoningSummary: "Ready.",
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "cs" })) as never,
    );
    await middleware.wrapToolCall?.(
      submission("products-json", "workflow_complete_execution", {
        candidateFinalResponse: "Done",
        deliverables: ["Plan"],
        validationEvidence: [],
        assumptions: [],
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "e" })) as never,
    );
    expect(middleware.getWorkflowState("products-json")?.phase).toBe("product_generation");

    const jsonBatch = {
      mode: "create",
      gridRoot: "products",
      products: [
        { id: "p1", title: "P1", description: "First" },
        { id: "p2", title: "P2", description: "Second" },
      ],
    };

    // Case 1: raw JSON object string.
    const rawJsonDelegation = rawRequest(
      "products-json",
      "product-generator",
      JSON.stringify(jsonBatch),
    );
    const rawJsonResponse = (await middleware.wrapToolCall?.(
      rawJsonDelegation as never,
      rawJsonDelegation.handler as never,
    )) as ToolMessage;
    expect(String(rawJsonResponse.content)).toContain("subagent_returned_json");
    expect(String(rawJsonResponse.content)).toContain("prose");
    expect(middleware.getWorkflowState("products-json")?.completedSubagent).toBeUndefined();
    expect(middleware.getWorkflowState("products-json")?.phase).toBe("product_generation");

    // Case 2: fenced ```json code block.
    const fencedDelegation = rawRequest(
      "products-json",
      "product-generator",
      `Here is the batch:\n\`\`\`json\n${JSON.stringify(jsonBatch, null, 2)}\n\`\`\``,
    );
    const fencedResponse = (await middleware.wrapToolCall?.(
      fencedDelegation as never,
      fencedDelegation.handler as never,
    )) as ToolMessage;
    expect(String(fencedResponse.content)).toContain("subagent_returned_json");
    expect(middleware.getWorkflowState("products-json")?.completedSubagent).toBeUndefined();

    // Case 3: prose reply is accepted and unlocks typed submission.
    const proseDelegation = rawRequest(
      "products-json",
      "product-generator",
      [
        "MODE: create",
        "GRID_ROOT: products",
        "PRODUCTS:",
        "- ID: p1",
        "  TITLE: P1",
        "  DESCRIPTION: First",
        "- ID: p2",
        "  TITLE: P2",
        "  DESCRIPTION: Second",
      ].join("\n"),
    );
    await middleware.wrapToolCall?.(proseDelegation as never, proseDelegation.handler as never);
    expect(middleware.getWorkflowState("products-json")?.completedSubagent).toBe(
      "product-generator",
    );
    const products = [
      { id: "p1", title: "P1", description: "First" },
      { id: "p2", title: "P2", description: "Second" },
    ];
    await middleware.wrapToolCall?.(
      submission("products-json", "workflow_submit_products", {
        mode: "create",
        gridRoot: "products",
        products,
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "p" })) as never,
    );
    expect(middleware.getWorkflowState("products-json")?.phase).toBe("review");
  });

  it("derives create defaults and explicit update counts from session history", async () => {
    const middleware = createWorkflowControllerMiddleware({
      ...options,
      productGenerationEnabled: true,
    });
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Create products")] },
      { configurable: { thread_id: "create-context" } },
    );
    expect(middleware.getWorkflowState("create-context")).toMatchObject({
      productMode: "create",
      targetProductCount: 3,
      existingProducts: null,
    });

    const previous = {
      version: 1,
      updates: [
        {
          type: "ui",
          rootId: "products",
          components: [
            { id: "products", component: "ProductGrid", children: ["old"] },
            { id: "old", component: "ProductCard", title: "Old", description: "Old" },
          ],
        },
      ],
    };
    await beforeAgent(
      {
        messages: [
          { role: "assistant", content: JSON.stringify(previous) },
          new HumanMessage("Replace with 4 products"),
        ],
      },
      { configurable: { thread_id: "update-count" } },
    );
    expect(middleware.getWorkflowState("update-count")).toMatchObject({
      productMode: "update",
      targetProductCount: 4,
      existingProducts: { gridRoot: "products" },
    });
  });

  it("rejects every submission tool in the wrong phase without changing state", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build something")] },
      { configurable: { thread_id: "wrong-phase" } },
    );
    for (const name of ["workflow_complete_execution", "workflow_submit_review"]) {
      const call = submission("wrong-phase", name, {});
      const result = (await middleware.wrapToolCall?.(
        call as never,
        (async () => new ToolMessage({ content: "ok", tool_call_id: name })) as never,
      )) as ToolMessage;
      expect(String(result.content)).toContain("invalid_workflow_phase");
      expect(middleware.getWorkflowState("wrong-phase")?.phase).toBe("clarification");
    }
  });

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

  it("defaults the controller retry limit to 4", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build a kanban board")] } as never,
      { configurable: { thread_id: "retry-budget" } } as never,
    );
    const afterModel = middleware.afterModel as { hook: Hook };

    let thrown: unknown;
    let lastUpdate: { jumpTo?: unknown; messages: HumanMessage[] } | undefined;
    // retryLimit defaults to 4: the first 4 afterModel calls inject feedback
    // and jump back to model; the 5th call exceeds the budget and throws.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        lastUpdate = (await afterModel.hook(
          { messages: [new AIMessage("I will narrate instead of calling tools.")] },
          { configurable: { thread_id: "retry-budget" } },
        )) as { jumpTo?: unknown; messages: HumanMessage[] };
      } catch (error) {
        thrown = error;
        break;
      }
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("could not complete this task");
    expect(lastUpdate?.jumpTo).toBe("model");
  });

  it("does not nest WORKFLOW_CONTROLLER_FEEDBACK envelopes across retries", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build a kanban board")] } as never,
      { configurable: { thread_id: "no-nesting" } } as never,
    );
    const afterModel = middleware.afterModel as { hook: Hook };

    const seenFeedbacks: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const update = (await afterModel.hook(
          { messages: [new AIMessage("narrating again")] },
          { configurable: { thread_id: "no-nesting" } },
        )) as { messages: HumanMessage[] };
        seenFeedbacks.push(String(update.messages[0]?.content ?? ""));
      } catch {
        break;
      }
    }
    // Every emitted feedback message should contain exactly one
    // WORKFLOW_CONTROLLER_FEEDBACK envelope header (no nesting).
    for (const feedback of seenFeedbacks) {
      const occurrences = feedback.split("WORKFLOW_CONTROLLER_FEEDBACK").length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it("translates prose clarifier and reviewer results into typed workflow tool calls", async () => {
    // End-to-end: the clarifier and reviewer subagents return PROSE. The
    // MainAgent reads that prose and calls workflow_submit_clarification and
    // workflow_submit_review with typed Zod-validated arguments. The subagents
    // never transition state directly.
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build a kanban board")] } as never,
      { configurable: { thread_id: "flow" } } as never,
    );

    // Clarifier returns prose with the stable labeled fields contract.
    const clarifierProse = [
      "STATUS: ready_to_proceed",
      "READY_TO_PROCEED: true",
      "QUESTIONS: none",
      "MISSING_INFORMATION: none",
      "ANSWERED_INFORMATION: scope=personal task tracker",
      "REASONING_SUMMARY: Enough information is available.",
    ].join("\n");
    const clarification = request("flow", "clarifier", clarifierProse);
    await middleware.wrapToolCall?.(clarification as never, clarification.handler as never);
    expect(middleware.getWorkflowState("flow")?.completedSubagent).toBe("clarifier");

    // MainAgent translates prose into typed args.
    const clarifySubmission = submission("flow", "workflow_submit_clarification", {
      requestKind: "products",
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      missingInformation: [],
      answeredInformation: [{ key: "scope", value: "personal task tracker" }],
      reasoningSummary: "Enough information is available.",
    });
    await middleware.wrapToolCall?.(
      clarifySubmission as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "clarify" })) as never,
    );
    expect(middleware.getWorkflowState("flow")?.phase).toBe("execution");

    const complete = submission("flow", "workflow_complete_execution", {
      candidateFinalResponse: "Done",
      deliverables: ["Layout"],
      validationEvidence: ["Checked"],
      assumptions: ["5-10 people"],
    });
    await middleware.wrapToolCall?.(
      complete as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "complete" })) as never,
    );
    expect(middleware.getWorkflowState("flow")?.phase).toBe("review");

    // Reviewer returns prose with the stable labeled fields contract.
    const reviewerProse = [
      "STATUS: approved",
      "SCORE: 95",
      "CRITICAL_ISSUES: none",
      "MAJOR_ISSUES: none",
      "MINOR_ISSUES: none",
      "REQUIRED_CHANGES: none",
      "FINAL_RECOMMENDATION: Ship it.",
    ].join("\n");
    const review = request("flow", "review-agent", reviewerProse);
    await middleware.wrapToolCall?.(review as never, review.handler as never);

    // MainAgent translates prose into typed args.
    const reviewSubmission = submission("flow", "workflow_submit_review", {
      status: "approved",
      score: 95,
      criticalIssues: [],
      majorIssues: [],
      minorIssues: [],
      requiredChanges: [],
      finalRecommendation: "Ship it.",
    });
    await middleware.wrapToolCall?.(
      reviewSubmission as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "review" })) as never,
    );
    expect(middleware.getWorkflowState("flow")?.phase).toBe("delivery_ready");
  });

  it("loops back to revision when reviewer prose asks for changes", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build something reviewable")] } as never,
      { configurable: { thread_id: "rev" } } as never,
    );
    const clarification = request("rev", "clarifier", "STATUS: ready_to_proceed");
    await middleware.wrapToolCall?.(clarification as never, clarification.handler as never);
    await middleware.wrapToolCall?.(
      submission("rev", "workflow_submit_clarification", {
        requestKind: "products",
        status: "ready_to_proceed",
        readyToProceed: true,
        questions: [],
        missingInformation: [],
        answeredInformation: [],
        reasoningSummary: "Proceed.",
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "c" })) as never,
    );
    await middleware.wrapToolCall?.(
      submission("rev", "workflow_complete_execution", {
        candidateFinalResponse: "v1",
        deliverables: ["d"],
        validationEvidence: ["e"],
        assumptions: ["a"],
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "e" })) as never,
    );
    expect(middleware.getWorkflowState("rev")?.phase).toBe("review");

    // Reviewer returns changes_required in prose.
    const revisionProse = [
      "STATUS: changes_required",
      "SCORE: 60",
      "CRITICAL_ISSUES: - missing tests (impact: correctness; evidence: none)",
      "MAJOR_ISSUES: none",
      "MINOR_ISSUES: none",
      "REQUIRED_CHANGES: - add tests",
      "FINAL_RECOMMENDATION: Rebuild with tests.",
    ].join("\n");
    const review = request("rev", "review-agent", revisionProse);
    await middleware.wrapToolCall?.(review as never, review.handler as never);
    await middleware.wrapToolCall?.(
      submission("rev", "workflow_submit_review", {
        status: "changes_required",
        score: 60,
        criticalIssues: [{ issue: "missing tests", impact: "correctness", evidence: "none" }],
        majorIssues: [],
        minorIssues: [],
        requiredChanges: ["add tests"],
        finalRecommendation: "Rebuild with tests.",
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "r" })) as never,
    );
    expect(middleware.getWorkflowState("rev")?.phase).toBe("revision");

    // Re-execute after revision feedback, then re-review and approve.
    await middleware.wrapToolCall?.(
      submission("rev", "workflow_complete_execution", {
        candidateFinalResponse: "v2",
        deliverables: ["d", "tests"],
        validationEvidence: ["e", "tests pass"],
        assumptions: ["a"],
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "e2" })) as never,
    );
    expect(middleware.getWorkflowState("rev")?.phase).toBe("review");
    const approval = request("rev", "review-agent", "STATUS: approved\nSCORE: 92");
    await middleware.wrapToolCall?.(approval as never, approval.handler as never);
    await middleware.wrapToolCall?.(
      submission("rev", "workflow_submit_review", {
        status: "approved",
        score: 92,
        criticalIssues: [],
        majorIssues: [],
        minorIssues: [],
        requiredChanges: [],
        finalRecommendation: "Ship.",
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "r2" })) as never,
    );
    expect(middleware.getWorkflowState("rev")?.phase).toBe("delivery_ready");
  });

  it("does not tell the model to avoid finalizing early during delivery_ready", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build something reviewable")] } as never,
      { configurable: { thread_id: "deliver" } } as never,
    );
    const clarification = request("deliver", "clarifier", "STATUS: ready_to_proceed");
    await middleware.wrapToolCall?.(clarification as never, clarification.handler as never);
    await middleware.wrapToolCall?.(
      submission("deliver", "workflow_submit_clarification", {
        requestKind: "products",
        status: "ready_to_proceed",
        readyToProceed: true,
        questions: [],
        missingInformation: [],
        answeredInformation: [],
        reasoningSummary: "Proceed.",
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "c" })) as never,
    );
    await middleware.wrapToolCall?.(
      submission("deliver", "workflow_complete_execution", {
        candidateFinalResponse: "v1",
        deliverables: ["d"],
        validationEvidence: ["e"],
        assumptions: ["a"],
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "e" })) as never,
    );
    const review = request("deliver", "review-agent", "STATUS: approved\nSCORE: 92");
    await middleware.wrapToolCall?.(review as never, review.handler as never);
    await middleware.wrapToolCall?.(
      submission("deliver", "workflow_submit_review", {
        status: "approved",
        score: 92,
        criticalIssues: [],
        majorIssues: [],
        minorIssues: [],
        requiredChanges: [],
        finalRecommendation: "Ship.",
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "r" })) as never,
    );
    expect(middleware.getWorkflowState("deliver")?.phase).toBe("delivery_ready");

    const wrapped = (await middleware.wrapModelCall?.(
      { systemPrompt: "BASE", runtime: { configurable: { thread_id: "deliver" } } } as never,
      (async (req: unknown) => req) as never,
    )) as unknown as { systemPrompt: string };
    expect(wrapped.systemPrompt).not.toContain("finalize early");
    expect(wrapped.systemPrompt).toContain("Proceed with the required action now.");
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

  it("keeps state unchanged for invalid submissions and requires delegation first", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build something")] } as never,
      { configurable: { thread_id: "bad" } } as never,
    );

    const bad = submission("bad", "workflow_submit_clarification", { invalidShape: true });
    const beforeDelegation = (await middleware.wrapToolCall?.(
      bad as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "bad" })) as never,
    )) as ToolMessage;
    expect(String(beforeDelegation.content)).toContain("required_subagent_not_completed");
    expect(middleware.getWorkflowState("bad")?.phase).toBe("clarification");

    const clarification = request("bad", "clarifier", "Use JSON if helpful, but prose is valid.");
    await middleware.wrapToolCall?.(clarification as never, clarification.handler as never);
    const invalid = (await middleware.wrapToolCall?.(
      bad as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "bad" })) as never,
    )) as ToolMessage;
    expect(String(invalid.content)).toContain("invalid_clarification_result");
    expect(middleware.getWorkflowState("bad")?.phase).toBe("clarification");
    expect(middleware.getWorkflowState("bad")?.completedSubagent).toBe("clarifier");
  });

  it("rejects malformed review submissions without changing workflow state", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build something")] } as never,
      { configurable: { thread_id: "bad-review" } } as never,
    );
    // Advance to the review phase with a valid clarification + execution.
    const clarification = request("bad-review", "clarifier", "STATUS: ready_to_proceed");
    await middleware.wrapToolCall?.(clarification as never, clarification.handler as never);
    await middleware.wrapToolCall?.(
      submission("bad-review", "workflow_submit_clarification", {
        requestKind: "products",
        status: "ready_to_proceed",
        readyToProceed: true,
        questions: [],
        missingInformation: [],
        answeredInformation: [],
        reasoningSummary: "Proceed.",
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "c" })) as never,
    );
    await middleware.wrapToolCall?.(
      submission("bad-review", "workflow_complete_execution", {
        candidateFinalResponse: "Done",
        deliverables: ["D"],
        validationEvidence: ["V"],
        assumptions: ["A"],
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "e" })) as never,
    );
    expect(middleware.getWorkflowState("bad-review")?.phase).toBe("review");

    // Submission before review-agent delegation must be rejected.
    const premature = submission("bad-review", "workflow_submit_review", {
      status: "approved",
      score: 90,
    });
    const prematureResponse = (await middleware.wrapToolCall?.(
      premature as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "p" })) as never,
    )) as ToolMessage;
    expect(String(prematureResponse.content)).toContain("required_subagent_not_completed");
    expect(middleware.getWorkflowState("bad-review")?.phase).toBe("review");

    // Now run review-agent, then submit malformed args.
    const review = request("bad-review", "review-agent", "STATUS: approved");
    await middleware.wrapToolCall?.(review as never, review.handler as never);
    const malformed = submission("bad-review", "workflow_submit_review", {
      status: "approved",
      // missing required fields: score, criticalIssues, etc.
    });
    const invalid = (await middleware.wrapToolCall?.(
      malformed as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "m" })) as never,
    )) as ToolMessage;
    expect(String(invalid.content)).toContain("invalid_review_report");
    expect(middleware.getWorkflowState("bad-review")?.phase).toBe("review");
    expect(middleware.getWorkflowState("bad-review")?.completedSubagent).toBe("review-agent");
  });

  describe("clarification entry", () => {
    it("always enters the clarification phase on a fresh request", async () => {
      // The clarifier subagent itself decides whether questions are needed;
      // the controller no longer short-circuits any request before then.
      const middleware = createWorkflowControllerMiddleware(options);
      const beforeAgent = middleware.beforeAgent as Hook;
      await beforeAgent(
        { messages: [new HumanMessage("continue")] } as never,
        { configurable: { thread_id: "fresh" } } as never,
      );

      const state = middleware.getWorkflowState("fresh");
      expect(state?.phase).toBe("clarification");
      expect(state?.clarification).toBeNull();
      expect(state?.clarificationResult).toBeUndefined();
    });

    it("routes a clarifier ready_to_proceed result straight to execution", async () => {
      // When the clarifier returns ready_to_proceed with no questions, the
      // reducer transitions the phase to execution.
      const middleware = createWorkflowControllerMiddleware(options);
      const beforeAgent = middleware.beforeAgent as Hook;
      await beforeAgent(
        { messages: [new HumanMessage("what is 2+2")] } as never,
        { configurable: { thread_id: "trivial" } } as never,
      );
      await middleware.wrapToolCall?.(
        request("trivial", "clarifier", "STATUS: ready_to_proceed") as never,
        (async () => new ToolMessage({ content: "ok", tool_call_id: "c" })) as never,
      );
      await middleware.wrapToolCall?.(
        submission("trivial", "workflow_submit_clarification", {
          requestKind: "products",
          status: "ready_to_proceed",
          readyToProceed: true,
          questions: [],
          missingInformation: [],
          answeredInformation: [],
          reasoningSummary: "Trivial self-contained request.",
        }) as never,
        (async () => new ToolMessage({ content: "ok", tool_call_id: "s" })) as never,
      );

      const state = middleware.getWorkflowState("trivial");
      expect(state?.phase).toBe("execution");
      expect(state?.clarificationResult?.status).toBe("ready_to_proceed");
      expect(state?.clarificationResult?.questions).toEqual([]);
      expect(state?.clarificationResult?.roundCount).toBe(0);
    });

    it("keeps bounded clarifier questions for an ambiguous request", async () => {
      const middleware = createWorkflowControllerMiddleware({
        ...options,
        maxClarificationRounds: 2,
        questionsPerRound: 2,
      });
      const beforeAgent = middleware.beforeAgent as Hook;
      await beforeAgent(
        { messages: [new HumanMessage("Build an app")] } as never,
        { configurable: { thread_id: "ambiguous" } } as never,
      );
      await middleware.wrapToolCall?.(
        request("ambiguous", "clarifier", "STATUS: needs_clarification") as never,
        (async () => new ToolMessage({ content: "ok", tool_call_id: "c" })) as never,
      );
      await middleware.wrapToolCall?.(
        submission("ambiguous", "workflow_submit_clarification", {
          requestKind: "products",
          status: "needs_clarification",
          readyToProceed: false,
          questions: [
            { id: "platform", question: "Which platform should the app target?" },
            { id: "audience", question: "Who is the intended audience?" },
          ],
          missingInformation: ["platform", "audience"],
          answeredInformation: [],
          reasoningSummary: "The platform and audience materially affect implementation.",
        }) as never,
        (async () => new ToolMessage({ content: "ok", tool_call_id: "s" })) as never,
      );

      const state = middleware.getWorkflowState("ambiguous");
      expect(state?.phase).toBe("waiting_for_user");
      expect(state?.clarification?.openQuestions).toHaveLength(2);
    });
  });

  it("rejects JSON-shaped clarifier replies and requires prose", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build a kanban board")] } as never,
      { configurable: { thread_id: "clarifier-json" } } as never,
    );

    // Fenced JSON block from the clarifier.
    const fenced = rawRequest(
      "clarifier-json",
      "clarifier",
      ["Here is my output:", "```json", '{"status":"ready_to_proceed"}', "```"].join("\n"),
    );
    const fencedResponse = (await middleware.wrapToolCall?.(
      fenced as never,
      fenced.handler as never,
    )) as ToolMessage;
    expect(String(fencedResponse.content)).toContain("subagent_returned_json");
    expect(middleware.getWorkflowState("clarifier-json")?.completedSubagent).toBeUndefined();
    expect(middleware.getWorkflowState("clarifier-json")?.phase).toBe("clarification");
    // The JSON rejection must consume one controller retry attempt.
    expect(middleware.getWorkflowState("clarifier-json")?.controllerRetryCount).toBe(1);

    // Prose reply unlocks the typed submission tool.
    const prose = rawRequest(
      "clarifier-json",
      "clarifier",
      [
        "STATUS: ready_to_proceed",
        "READY_TO_PROCEED: true",
        "QUESTIONS: none",
        "MISSING_INFORMATION: none",
        "ANSWERED_INFORMATION: scope=personal",
        "REASONING_SUMMARY: Ready.",
      ].join("\n"),
    );
    await middleware.wrapToolCall?.(prose as never, prose.handler as never);
    expect(middleware.getWorkflowState("clarifier-json")?.completedSubagent).toBe("clarifier");
    await middleware.wrapToolCall?.(
      submission("clarifier-json", "workflow_submit_clarification", {
        requestKind: "products",
        status: "ready_to_proceed",
        readyToProceed: true,
        questions: [],
        missingInformation: [],
        answeredInformation: [{ key: "scope", value: "personal" }],
        reasoningSummary: "Ready.",
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "s" })) as never,
    );
    // Transitioning out of clarification resets the retry counter.
    expect(middleware.getWorkflowState("clarifier-json")?.phase).toBe("execution");
    expect(middleware.getWorkflowState("clarifier-json")?.controllerRetryCount).toBe(0);
  });

  it("rejects JSON-shaped review-agent replies and requires prose", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build something reviewable")] } as never,
      { configurable: { thread_id: "reviewer-json" } } as never,
    );
    await middleware.wrapToolCall?.(
      request("reviewer-json", "clarifier", "STATUS: ready_to_proceed") as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "c" })) as never,
    );
    await middleware.wrapToolCall?.(
      submission("reviewer-json", "workflow_submit_clarification", {
        requestKind: "products",
        status: "ready_to_proceed",
        readyToProceed: true,
        questions: [],
        missingInformation: [],
        answeredInformation: [],
        reasoningSummary: "Proceed.",
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "cs" })) as never,
    );
    await middleware.wrapToolCall?.(
      submission("reviewer-json", "workflow_complete_execution", {
        candidateFinalResponse: "Done",
        deliverables: ["D"],
        validationEvidence: ["V"],
        assumptions: ["A"],
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "e" })) as never,
    );
    expect(middleware.getWorkflowState("reviewer-json")?.phase).toBe("review");

    // Leading-brace JSON object from review-agent.
    const rawJson = rawRequest(
      "reviewer-json",
      "review-agent",
      JSON.stringify({ status: "approved", score: 95 }),
    );
    const rawJsonResponse = (await middleware.wrapToolCall?.(
      rawJson as never,
      rawJson.handler as never,
    )) as ToolMessage;
    expect(String(rawJsonResponse.content)).toContain("subagent_returned_json");
    expect(middleware.getWorkflowState("reviewer-json")?.completedSubagent).toBeUndefined();
    expect(middleware.getWorkflowState("reviewer-json")?.phase).toBe("review");
    expect(middleware.getWorkflowState("reviewer-json")?.controllerRetryCount).toBe(1);

    // Prose reply unlocks the typed submission tool.
    const prose = rawRequest(
      "reviewer-json",
      "review-agent",
      [
        "STATUS: approved",
        "SCORE: 95",
        "CRITICAL_ISSUES: none",
        "MAJOR_ISSUES: none",
        "MINOR_ISSUES: none",
        "REQUIRED_CHANGES: none",
        "FINAL_RECOMMENDATION: Ship it.",
      ].join("\n"),
    );
    await middleware.wrapToolCall?.(prose as never, prose.handler as never);
    expect(middleware.getWorkflowState("reviewer-json")?.completedSubagent).toBe("review-agent");
    await middleware.wrapToolCall?.(
      submission("reviewer-json", "workflow_submit_review", {
        status: "approved",
        score: 95,
        criticalIssues: [],
        majorIssues: [],
        minorIssues: [],
        requiredChanges: [],
        finalRecommendation: "Ship it.",
      }) as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "r" })) as never,
    );
    expect(middleware.getWorkflowState("reviewer-json")?.phase).toBe("delivery_ready");
  });

  it("bounds repeated JSON rejections by the controller retry limit", async () => {
    // Default controllerRetryLimit is 4: the first 4 JSON rejections return a
    // feedback tool message and tick the counter; the 5th call exceeds the
    // budget and throws WorkflowRuntimeError. This protects against a model
    // that keeps re-delegating to a misbehaving subagent instead of either
    // narrating (which would hit afterModel) or producing prose.
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build a kanban board")] } as never,
      { configurable: { thread_id: "json-budget" } } as never,
    );

    const jsonReply = () =>
      rawRequest("json-budget", "clarifier", JSON.stringify({ status: "ready_to_proceed" }));

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const call = jsonReply();
      const response = (await middleware.wrapToolCall?.(
        call as never,
        call.handler as never,
      )) as ToolMessage;
      expect(String(response.content)).toContain("subagent_returned_json");
      expect(middleware.getWorkflowState("json-budget")?.controllerRetryCount).toBe(attempt + 1);
    }

    await expect(
      (async () => {
        const call = jsonReply();
        await middleware.wrapToolCall?.(call as never, call.handler as never);
      })(),
    ).rejects.toThrow(/could not complete this task/);
    expect(middleware.getWorkflowState("json-budget")?.phase).toBe("error");
  });

  it("ticks the controller retry budget on wrong-subagent delegation", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build a kanban board")] } as never,
      { configurable: { thread_id: "wrong-sub" } } as never,
    );

    const wrong = request("wrong-sub", "review-agent", "STATUS: ignored");
    const response = (await middleware.wrapToolCall?.(
      wrong as never,
      wrong.handler as never,
    )) as ToolMessage;
    expect(String(response.content)).toContain("wrong_subagent");
    expect(middleware.getWorkflowState("wrong-sub")?.controllerRetryCount).toBe(1);
    expect(middleware.getWorkflowState("wrong-sub")?.phase).toBe("clarification");
  });

  it("bounds repeated wrong-subagent delegations by the controller retry limit", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build a kanban board")] } as never,
      { configurable: { thread_id: "wrong-budget" } } as never,
    );

    const wrong = () => request("wrong-budget", "review-agent", "STATUS: ignored");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const call = wrong();
      const response = (await middleware.wrapToolCall?.(
        call as never,
        call.handler as never,
      )) as ToolMessage;
      expect(String(response.content)).toContain("wrong_subagent");
      expect(middleware.getWorkflowState("wrong-budget")?.controllerRetryCount).toBe(attempt + 1);
    }

    await expect(
      (async () => {
        const call = wrong();
        await middleware.wrapToolCall?.(call as never, call.handler as never);
      })(),
    ).rejects.toThrow(/could not complete this task/);
    expect(middleware.getWorkflowState("wrong-budget")?.phase).toBe("error");
  });

  it("leaves the workflow phase unchanged on a non-exhausting wrong-subagent delegation", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build a kanban board")] } as never,
      { configurable: { thread_id: "wrong-phase" } } as never,
    );
    const beforePhase = middleware.getWorkflowState("wrong-phase")?.phase;

    const wrong = request("wrong-phase", "review-agent", "STATUS: ignored");
    await middleware.wrapToolCall?.(wrong as never, wrong.handler as never);

    expect(middleware.getWorkflowState("wrong-phase")?.phase).toBe(beforePhase);
    expect(middleware.getWorkflowState("wrong-phase")?.phase).not.toBe("error");
  });
});
