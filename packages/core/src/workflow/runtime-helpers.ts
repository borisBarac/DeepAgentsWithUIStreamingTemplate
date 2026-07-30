import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { ToolCallRequest } from "langchain";

import { productContext } from "./products.ts";
import { reduceWorkflowState, resolveWorkflowDecision } from "./reducer.ts";
import type { WorkflowError, WorkflowState } from "./types.ts";

/** Thrown when the workflow controller reaches a terminal error state. */
export class WorkflowRuntimeError extends Error {
  constructor(
    readonly terminalError: WorkflowError,
    readonly subagent?: string,
  ) {
    super(USER_FACING_WORKFLOW_ERRORS[terminalError.code] ?? terminalError.message);
    this.name = "WorkflowRuntimeError";
  }
}

const USER_FACING_WORKFLOW_ERRORS: Record<WorkflowError["code"], string> = {
  controller_retry_exhausted:
    "The agent could not complete this task after multiple attempts. Please rephrase the request or try again.",
  invalid_transition:
    "The workflow entered an unexpected state. Please rephrase the request or try again.",
  malformed_output_limit_exceeded:
    "The agent could not produce a valid response. Please try again.",
};

export function threadId(runtime: unknown): string {
  return String(
    (runtime as { configurable?: { thread_id?: unknown } })?.configurable?.thread_id ??
      "__default__",
  );
}

export function latestHumanText(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof HumanMessage) {
      return typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
    }
    if (
      typeof message === "object" &&
      message !== null &&
      "role" in message &&
      (message as { role?: unknown }).role === "user"
    ) {
      const content = (message as { content?: unknown }).content;
      return typeof content === "string" ? content : JSON.stringify(content ?? "");
    }
  }
  return "";
}

export function proseWorkflowPacket(state: WorkflowState): string {
  if (!state.outcome) return "";
  const lines: string[] = [
    "",
    "",
    "Authoritative workflow packet (read-only context; respond in prose per your contract):",
  ];
  lines.push("REQUEST_KIND: products");
  if (state.outcome.candidateFinalResponse) {
    lines.push(`EXECUTION_OUTCOME: ${state.outcome.candidateFinalResponse}`);
  }
  if (state.outcome.deliverables.length > 0) {
    lines.push("DELIVERABLES:");
    for (const deliverable of state.outcome.deliverables) lines.push(`- ${deliverable}`);
  }
  lines.push(`PRODUCT_MODE: ${state.productMode}`);
  lines.push(`GRID_ROOT: ${state.existingProducts?.gridRoot ?? "products"}`);
  lines.push(`TARGET_PRODUCT_COUNT: ${state.targetProductCount}`);
  const existing = state.existingProducts?.products ?? [];
  if (existing.length > 0) {
    lines.push("EXISTING_PRODUCTS:");
    for (const product of existing) {
      lines.push(`- ID: ${product.id}`);
      lines.push(`  TITLE: ${product.title}`);
    }
  } else {
    lines.push("EXISTING_PRODUCTS: none");
  }
  const generated = state.generatedProducts?.products ?? [];
  if (generated.length > 0) {
    lines.push("GENERATED_PRODUCTS:");
    for (const product of generated) {
      lines.push(`- ID: ${product.id}`);
      lines.push(`  TITLE: ${product.title}`);
    }
  }
  lines.push(`REVIEW_FEEDBACK: ${state.lastFeedback ?? "none"}`);
  return lines.join("\n");
}

const PROSE_CONTRACT_SUBAGENTS = new Set(["clarifier", "product-generator", "review-agent"]);

export function looksLikeJsonSubagentReply(content: unknown, subagent: string): boolean {
  if (!PROSE_CONTRACT_SUBAGENTS.has(subagent)) return false;
  const text = typeof content === "string" ? content.trimStart() : "";
  if (!text) return false;
  if (text.startsWith("{") || text.startsWith("[")) return true;
  return /```(?:json|jsonc)?\s*[\r\n]*\s*[{[]/.test(text);
}

export function hasToolCalls(message: unknown): boolean {
  return (
    message instanceof AIMessage &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0
  );
}

export const CONTROLLER_FEEDBACK_ENVELOPE = "WORKFLOW_CONTROLLER_FEEDBACK";
export const DELEGATION_TOOL_NAME = "task";
export const DELEGATION_SUBAGENT_ARG = "subagent_type";

export function feedbackTail(canFinalize: boolean): string {
  return canFinalize
    ? "Proceed with the required action now."
    : "Do the required action now. Do not narrate or finalize early.";
}

export function feedbackMessage(state: WorkflowState): string {
  const decision = resolveWorkflowDecision(state);
  const feedback =
    decision.feedback && !decision.feedback.startsWith(CONTROLLER_FEEDBACK_ENVELOPE)
      ? decision.feedback
      : undefined;
  return [
    CONTROLLER_FEEDBACK_ENVELOPE,
    `phase=${decision.phase}`,
    `requiredAction=${decision.requiredAction}`,
    decision.requiredSubagent ? `requiredSubagent=${decision.requiredSubagent}` : undefined,
    feedback ? `reviewFeedback=${feedback}` : undefined,
    feedbackTail(decision.canFinalize),
  ]
    .filter(Boolean)
    .join("\n");
}

export function toolMessage<S extends Record<string, unknown>, C>(
  request: ToolCallRequest<S, C>,
  content: unknown,
): ToolMessage {
  return new ToolMessage({
    content: typeof content === "string" ? content : JSON.stringify(content),
    tool_call_id: request.toolCall.id ?? "workflow-controller",
    name: request.toolCall.name,
  });
}

export { productContext, reduceWorkflowState, resolveWorkflowDecision };
