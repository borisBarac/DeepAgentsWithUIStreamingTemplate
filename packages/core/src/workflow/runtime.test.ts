import { describe, expect, it } from "bun:test";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { InMemoryStore } from "@langchain/langgraph";

import type { ClarificationTriageClassifier } from "../clarification/index.ts";
import {
  createWorkflowControllerMiddleware,
  workflowCompleteExecutionTool,
  workflowSubmitClarificationTool,
  workflowSubmitReviewTool,
} from "./runtime.ts";

const options = {
  maxClarificationRounds: 1,
  questionsPerRound: 3 as const,
  maxRevisions: 2,
};

function fakeTriageClassifier(
  response: { decision: "skip" | "proceed"; reason: string } | Error,
): ClarificationTriageClassifier & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async invoke(input: unknown) {
      calls.push(input);
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

function conditionalTriageClassifier(
  router: (request: string) => { decision: "skip" | "proceed"; reason: string } | Error,
): ClarificationTriageClassifier & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async invoke(input: unknown) {
      calls.push(input);
      const messages = input as { role: string; content: string }[];
      const userMessage = messages.find((message) => message.role === "user")?.content ?? "";
      const probe = "Latest user message:\n";
      const request = userMessage.includes(probe)
        ? userMessage.slice(userMessage.indexOf(probe) + probe.length).trim()
        : userMessage;
      const result = router(request);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

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

function submission(threadId: string, name: string, args: Record<string, unknown>) {
  return {
    toolCall: { id: `${threadId}-${name}`, name, args },
    runtime: { configurable: { thread_id: threadId } },
    state: {},
    tool: undefined,
  };
}

describe("workflow controller middleware", () => {
  it("registers three typed submission tools that reject invalid arguments", async () => {
    expect([
      workflowSubmitClarificationTool.name,
      workflowCompleteExecutionTool.name,
      workflowSubmitReviewTool.name,
    ]).toEqual([
      "workflow_submit_clarification",
      "workflow_complete_execution",
      "workflow_submit_review",
    ]);
    for (const workflowTool of [
      workflowSubmitClarificationTool,
      workflowCompleteExecutionTool,
      workflowSubmitReviewTool,
    ]) {
      await expect(
        (workflowTool as { invoke(input: unknown): Promise<unknown> }).invoke({ invalid: true }),
      ).rejects.toBeDefined();
    }
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

  it("continues readiness through execution and review", async () => {
    const middleware = createWorkflowControllerMiddleware(options);
    const beforeAgent = middleware.beforeAgent as Hook;
    await beforeAgent(
      { messages: [new HumanMessage("Build a kanban board")] } as never,
      { configurable: { thread_id: "flow" } } as never,
    );
    const clarification = request("flow", "clarifier", {
      prose: "Enough information is available.",
    });
    await middleware.wrapToolCall?.(clarification as never, clarification.handler as never);
    expect(middleware.getWorkflowState("flow")?.completedSubagent).toBe("clarifier");

    const clarifySubmission = submission("flow", "workflow_submit_clarification", {
      status: "ready_to_proceed",
      readyToProceed: true,
      questions: [],
      missingInformation: [],
      answeredInformation: [],
      reasoningSummary: "Proceed.",
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

    const review = request("flow", "review-agent", "Approved. Score 95.");
    await middleware.wrapToolCall?.(review as never, review.handler as never);
    const reviewSubmission = submission("flow", "workflow_submit_review", {
      status: "approved",
      score: 95,
      criticalIssues: [],
      majorIssues: [],
      minorIssues: [],
      requiredChanges: [],
      finalRecommendation: "Deliver",
    });
    await middleware.wrapToolCall?.(
      reviewSubmission as never,
      (async () => new ToolMessage({ content: "ok", tool_call_id: "review" })) as never,
    );
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

  describe("triage gate", () => {
    it("preserves legacy always-clarify behavior when no triage classifier is supplied", async () => {
      const middleware = createWorkflowControllerMiddleware(options);
      const beforeAgent = middleware.beforeAgent as Hook;
      await beforeAgent(
        { messages: [new HumanMessage("continue")] } as never,
        { configurable: { thread_id: "no-triage" } } as never,
      );

      expect(middleware.getWorkflowState("no-triage")?.phase).toBe("clarification");
      expect(middleware.getWorkflowState("no-triage")?.lastTriageDecision).toBeUndefined();
    });

    it("preserves legacy behavior when triageEnabled is false even with a classifier", async () => {
      const classifier = fakeTriageClassifier({ decision: "skip", reason: "skip me" });
      const middleware = createWorkflowControllerMiddleware({
        ...options,
        triageClassifier: classifier,
        triageEnabled: false,
      });
      const beforeAgent = middleware.beforeAgent as Hook;
      await beforeAgent(
        { messages: [new HumanMessage("continue")] } as never,
        { configurable: { thread_id: "triage-off" } } as never,
      );

      expect(classifier.calls).toHaveLength(0);
      expect(middleware.getWorkflowState("triage-off")?.phase).toBe("clarification");
    });

    it("skips the clarifier round when the classifier decides skip", async () => {
      const classifier = fakeTriageClassifier({ decision: "skip", reason: "continuation token" });
      const middleware = createWorkflowControllerMiddleware({
        ...options,
        triageClassifier: classifier,
      });
      const beforeAgent = middleware.beforeAgent as Hook;
      await beforeAgent(
        { messages: [new HumanMessage("continue")] } as never,
        { configurable: { thread_id: "skip" } } as never,
      );

      expect(classifier.calls).toHaveLength(1);
      const state = middleware.getWorkflowState("skip");
      expect(state?.phase).toBe("execution");
      expect(state?.clarificationResult?.status).toBe("ready_to_proceed");
      expect(state?.clarificationResult?.skipReason).toBe("triage_classifier");
      expect(state?.clarificationResult?.questions).toEqual([]);
      expect(state?.clarificationResult?.reasoningSummary).toContain("continuation token");
      expect(state?.lastTriageDecision?.decision).toBe("skip");
    });

    it("keeps the clarification phase when the classifier decides proceed", async () => {
      const classifier = fakeTriageClassifier({ decision: "proceed", reason: "ambiguous scope" });
      const middleware = createWorkflowControllerMiddleware({
        ...options,
        triageClassifier: classifier,
      });
      const beforeAgent = middleware.beforeAgent as Hook;
      await beforeAgent(
        { messages: [new HumanMessage("Build me a house")] } as never,
        { configurable: { thread_id: "proceed" } } as never,
      );

      expect(classifier.calls).toHaveLength(1);
      const state = middleware.getWorkflowState("proceed");
      expect(state?.phase).toBe("clarification");
      expect(state?.clarificationResult).toBeUndefined();
      expect(state?.lastTriageDecision?.decision).toBe("proceed");
    });

    it("falls back to clarify phase when the classifier throws", async () => {
      const classifier = fakeTriageClassifier(new Error("model offline"));
      const middleware = createWorkflowControllerMiddleware({
        ...options,
        triageClassifier: classifier,
      });
      const beforeAgent = middleware.beforeAgent as Hook;
      await beforeAgent(
        { messages: [new HumanMessage("anything")] } as never,
        { configurable: { thread_id: "failing" } } as never,
      );

      const state = middleware.getWorkflowState("failing");
      expect(state?.phase).toBe("clarification");
      // The decision should default to PROCEED so a later hook could act on it,
      // but no transition should occur.
      expect(state?.lastTriageDecision?.decision).toBe("proceed");
    });

    it("does not re-classify the same message on subsequent beforeAgent calls", async () => {
      const classifier = fakeTriageClassifier({ decision: "proceed", reason: "first call" });
      const middleware = createWorkflowControllerMiddleware({
        ...options,
        triageClassifier: classifier,
      });
      const beforeAgent = middleware.beforeAgent as Hook;
      const runtime = { configurable: { thread_id: "memo" } };
      await beforeAgent({ messages: [new HumanMessage("Build X")] } as never, runtime as never);
      await beforeAgent({ messages: [new HumanMessage("Build X")] } as never, runtime as never);

      expect(classifier.calls).toHaveLength(1);
    });

    it("does NOT re-classify a follow-up reply after the first clarifier round", async () => {
      // Regression: after the first clarifier round runs (state.clarification
      // is non-null), subsequent user messages must go through the clarifier
      // normally — even if they look "continuation-y" to the triage
      // classifier. Re-triaging answers was causing the state machine to jump
      // to execution without ever consuming the user's answers (see
      // `controller_retry_exhausted` bug).
      const classifier = conditionalTriageClassifier((request) =>
        request.includes("continue")
          ? { decision: "skip", reason: "user said continue" }
          : { decision: "proceed", reason: "ambiguous" },
      );
      const middleware = createWorkflowControllerMiddleware({
        ...options,
        maxClarificationRounds: 2,
        triageClassifier: classifier,
      });
      const beforeAgent = middleware.beforeAgent as Hook;
      const runtime = { configurable: { thread_id: "follow-up" } };

      // Round 1: classifier proceeds, clarifier runs, asks a question.
      await beforeAgent(
        { messages: [new HumanMessage("build a thing")] } as never,
        runtime as never,
      );
      expect(middleware.getWorkflowState("follow-up")?.phase).toBe("clarification");
      expect(classifier.calls).toHaveLength(1);

      const clarifierRound = request("follow-up", "clarifier", "Need more info.");
      await middleware.wrapToolCall?.(clarifierRound as never, clarifierRound.handler as never);
      await middleware.wrapToolCall?.(
        submission("follow-up", "workflow_submit_clarification", {
          status: "needs_clarification",
          readyToProceed: false,
          questions: [{ id: "scope", question: "What scope?" }],
          missingInformation: ["scope"],
          answeredInformation: [],
          reasoningSummary: "Need scope.",
        }) as never,
        (async () => new ToolMessage({ content: "ok", tool_call_id: "x" })) as never,
      );
      expect(middleware.getWorkflowState("follow-up")?.phase).toBe("waiting_for_user");

      // User replies "continue" — triage must NOT fire again. The state goes
      // back to clarification (so the supervisor can run a normal clarifier
      // round and consume the reply) instead of jumping to execution.
      await beforeAgent({ messages: [new HumanMessage("continue")] } as never, runtime as never);
      expect(classifier.calls).toHaveLength(1);
      const finalState = middleware.getWorkflowState("follow-up");
      expect(finalState?.phase).toBe("clarification");
      expect(finalState?.clarificationResult?.skipReason).toBeUndefined();
      expect(finalState?.lastTriageMessage).toBe("build a thing");
    });
  });
});
