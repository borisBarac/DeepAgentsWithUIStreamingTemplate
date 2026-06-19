import {
  createReviewState,
  markReviewCaveated,
  parseReviewReport,
  type ReviewReport,
  type ReviewState,
  recordReviewReport,
} from "../review/index.ts";
import { composeFinalAnswer } from "./composition.ts";
import { missingAgentError, toStructuredError } from "./errors.ts";
import { extractStageOutput } from "./messages.ts";
import { type NodeContext, resolveAgent } from "./runtime.ts";
import type { OrchestratedGraphState } from "./state.ts";
import type { OrchestratedDeepAgentError, OrchestratedDeepAgentMessage } from "./types.ts";

function buildReviewContextPacket(
  state: OrchestratedGraphState,
  candidate: string,
): OrchestratedDeepAgentMessage[] {
  const messages: OrchestratedDeepAgentMessage[] = [];
  messages.push({ role: "system", content: `Original user request:\n${state.task}` });

  const answers = state.clarification?.answeredInformation ?? [];
  if (answers.length > 0) {
    messages.push({
      role: "system",
      content: `Clarifications provided:\n${answers
        .map((answer) => `- ${answer.key}: ${answer.value}`)
        .join("\n")}`,
    });
  }
  if (state.researchResult) {
    messages.push({ role: "system", content: `Research performed:\n${state.researchResult}` });
  }
  if (state.codeResult) {
    messages.push({
      role: "system",
      content: `Implementation notes:\n${state.codeResult}`,
    });
  }
  const errors = state.errors ?? [];
  if (errors.length > 0) {
    messages.push({
      role: "system",
      content: `Known limitations:\n${errors
        .map((entry) => `- [${entry.category}] ${entry.node}: ${entry.message}`)
        .join("\n")}`,
    });
  }

  messages.push(...(state.messages ?? []));
  messages.push({
    role: "user",
    content: `Review the following candidate final answer. Return the structured review report only.\n\nCandidate:\n${candidate}`,
  });
  return messages;
}

async function reviseCandidate(
  ctx: NodeContext,
  candidate: string,
  report: ReviewReport,
): Promise<string | null> {
  const reviser = resolveAgent(ctx, "finalizer");
  if (!reviser) return null;

  try {
    const result = await reviser.invoke({
      messages: [
        {
          role: "system",
          content: `Required changes from review:\n${report.requiredChanges
            .map((change) => `- ${change}`)
            .join("\n")}`,
        },
        {
          role: "user",
          content: `Revise the following candidate to address every required change. Return only the revised final answer.\n\nCandidate:\n${candidate}`,
        },
      ],
    });
    const revised = extractStageOutput(result.messages);
    return revised || null;
  } catch {
    return null;
  }
}

type ReviewOutcome = {
  state: ReviewState;
  candidate: string;
  errors?: OrchestratedDeepAgentError[];
};

function reviewOutcome(
  state: ReviewState,
  candidate: string,
  errors?: OrchestratedDeepAgentError[],
): ReviewOutcome {
  return { state, candidate, errors };
}

async function runReviewLoop(
  ctx: NodeContext,
  state: OrchestratedGraphState,
  candidate: string,
): Promise<ReviewOutcome> {
  const maxRevisions = ctx.review.maxRevisions;
  let reviewState = createReviewState({ maxRevisions });
  const reviewer = resolveAgent(ctx, "reviewer");

  if (!reviewer) {
    return reviewOutcome(markReviewCaveated({ ...reviewState, status: "blocked" }), candidate, [
      missingAgentError("reviewer", false),
    ]);
  }

  let currentCandidate = candidate;

  for (let attempt = 1; attempt <= maxRevisions; attempt += 1) {
    reviewState = { ...reviewState, status: "review_requested" };

    let report: ReviewReport;
    try {
      const result = await reviewer.invoke({
        messages: buildReviewContextPacket(state, currentCandidate),
      });
      report = parseReviewReport(extractStageOutput(result.messages));
    } catch (error) {
      return reviewOutcome(
        markReviewCaveated({
          ...reviewState,
          status: "blocked",
          reviewCount: attempt,
        }),
        currentCandidate,
        [toStructuredError(error, "reviewer", { required: false })],
      );
    }

    reviewState = recordReviewReport(reviewState, report, attempt);

    switch (report.status) {
      case "approved":
        return reviewOutcome({ ...reviewState, status: "approved" }, currentCandidate);
      case "blocked":
        return reviewOutcome(markReviewCaveated(reviewState), currentCandidate);
      case "changes_required":
        if (attempt < maxRevisions) {
          const revised = await reviseCandidate(ctx, currentCandidate, report);
          if (revised !== null) {
            currentCandidate = revised;
            break;
          }
          return reviewOutcome(markReviewCaveated(reviewState), currentCandidate);
        }
        break;
    }
  }

  return reviewOutcome(markReviewCaveated(reviewState), currentCandidate);
}

function composeCaveatedAnswer(candidate: string, reviewState: ReviewState): string {
  const report = reviewState.report;
  const lines: string[] = [];

  if (reviewState.status === "blocked") {
    lines.push("Review could not approve this result (blocked).");
  } else if (reviewState.status === "changes_required") {
    lines.push(
      `Review required changes after ${reviewState.reviewCount} review pass(es); the review loop limit (${reviewState.maxRevisions}) was reached without approval.`,
    );
  } else {
    lines.push("Review did not approve this result.");
  }

  if (report?.requiredChanges.length) {
    lines.push(
      `Required changes:\n${report.requiredChanges.map((change) => `- ${change}`).join("\n")}`,
    );
  }
  if (report?.finalRecommendation) {
    lines.push(`Reviewer recommendation: ${report.finalRecommendation}`);
  }

  return `${candidate}\n\n## Review Caveats\nThis result was NOT approved by review.\n${lines.join("\n")}`.trim();
}

export function createFinalizerNode(ctx: NodeContext) {
  return async (state: OrchestratedGraphState): Promise<Partial<OrchestratedGraphState>> => {
    const draft = composeFinalAnswer(state);
    const errors: OrchestratedDeepAgentError[] = [];

    let candidate = draft;
    const finalizer = resolveAgent(ctx, "finalizer");
    if (finalizer) {
      try {
        const result = await finalizer.invoke({
          messages: [
            ...(state.messages ?? []),
            {
              role: "user",
              content: `Turn the following orchestration output into the final user-facing response:\n\n${draft}`,
            },
          ],
        });
        const refined = extractStageOutput(result.messages);
        if (refined) candidate = refined;
      } catch (error) {
        errors.push(toStructuredError(error, "finalizer", { required: false }));
      }
    }

    const outcome = await runReviewLoop(ctx, state, candidate);
    if (outcome.errors) errors.push(...outcome.errors);

    const finalAnswer = outcome.state.caveated
      ? composeCaveatedAnswer(outcome.candidate, outcome.state)
      : outcome.candidate;

    const update: Partial<OrchestratedGraphState> = {
      finalAnswer,
      review: outcome.state,
      next: "end",
    };
    if (errors.length > 0) update.errors = errors;
    return update;
  };
}
