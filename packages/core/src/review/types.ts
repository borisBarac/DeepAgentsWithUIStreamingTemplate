import { z } from "zod";

export type ReviewReportStatus = "approved" | "changes_required" | "blocked";

export type ReviewLifecycleStatus =
  | "review_required"
  | "review_requested"
  | "changes_required"
  | "approved"
  | "blocked";

export type ReviewIssue = {
  issue: string;
  impact: string;
  evidence: string;
};

export type ReviewReport = {
  status: ReviewReportStatus;
  score: number;
  criticalIssues: ReviewIssue[];
  majorIssues: ReviewIssue[];
  minorIssues: ReviewIssue[];
  requiredChanges: string[];
  finalRecommendation: string;
};

export type ReviewConfig = {
  maxRevisions: number;
};

export type ReviewState = {
  status: ReviewLifecycleStatus;
  report?: ReviewReport;
  reports: ReviewReport[];
  reviewCount: number;
  maxRevisions: number;
  caveated: boolean;
  required: boolean;
};

export const reviewReportStatusSchema = z.enum(["approved", "changes_required", "blocked"]);

export const reviewLifecycleStatusSchema = z.enum([
  "review_required",
  "review_requested",
  "changes_required",
  "approved",
  "blocked",
]);

export const reviewIssueSchema = z.object({
  issue: z.string(),
  impact: z.string(),
  evidence: z.string(),
});

export const reviewReportSchema = z.object({
  status: reviewReportStatusSchema,
  score: z.number(),
  criticalIssues: z.array(reviewIssueSchema),
  majorIssues: z.array(reviewIssueSchema),
  minorIssues: z.array(reviewIssueSchema),
  requiredChanges: z.array(z.string()),
  finalRecommendation: z.string(),
});

export const reviewConfigSchema = z.object({
  maxRevisions: z.number().int().positive(),
});
