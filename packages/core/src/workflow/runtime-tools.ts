import { tool } from "langchain";
import { z } from "zod";

import { clarificationResultSchema } from "../clarification/index.ts";
import { reviewReportSchema } from "../review/index.ts";
import type { ProductBatch } from "./products.ts";
import type { WorkflowOutcomePacket } from "./types.ts";

const workflowOutcomeSchema = z.object({
  candidateFinalResponse: z.string().min(1),
  deliverables: z.array(z.string()),
  validationEvidence: z.array(z.string()),
  assumptions: z.array(z.string()),
});

export const productItemSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  imagePrompt: z.string().trim().min(1).optional(),
});

export const productBatchSchema = z.object({
  mode: z.enum(["create", "update"]),
  gridRoot: z.string().trim().min(1),
  products: z.array(productItemSchema).min(1),
});

export const workflowCompleteExecutionTool = tool(
  async (input: WorkflowOutcomePacket) => JSON.stringify(input),
  {
    name: "workflow_complete_execution",
    description: "Submit the complete execution outcome packet. Required before review.",
    schema: workflowOutcomeSchema,
  },
);

export const clarificationSubmissionSchema = clarificationResultSchema.omit({
  roundCount: true,
  maxRounds: true,
});

export const workflowSubmitClarificationTool = tool(async (input) => JSON.stringify(input), {
  name: "workflow_submit_clarification",
  description:
    "Submit the clarifier result after delegating to the clarifier. The host supplies round counters.",
  schema: clarificationSubmissionSchema,
});

export const workflowSubmitReviewTool = tool(async (input) => JSON.stringify(input), {
  name: "workflow_submit_review",
  description: "Submit the review report after delegating to review-agent.",
  schema: reviewReportSchema,
});

export const workflowSubmitProductsTool = tool(
  async (input: ProductBatch) => JSON.stringify(input),
  {
    name: "workflow_submit_products",
    description: "Submit the full replacement product batch after delegating to product-generator.",
    schema: productBatchSchema,
  },
);

export { workflowOutcomeSchema };
