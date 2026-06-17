import { type ReviewReport, type ReviewReportStatus, reviewReportSchema } from "./types.ts";

type RawReviewIssue = {
  issue?: unknown;
  impact?: unknown;
  evidence?: unknown;
};

type RawReviewReport = {
  status?: unknown;
  score?: unknown;
  criticalIssues?: unknown;
  critical_issues?: unknown;
  majorIssues?: unknown;
  major_issues?: unknown;
  minorIssues?: unknown;
  minor_issues?: unknown;
  requiredChanges?: unknown;
  required_changes?: unknown;
  finalRecommendation?: unknown;
  final_recommendation?: unknown;
};

const JSON_FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/;

function extractJsonObject(content: string): string | null {
  const fenced = content.match(JSON_FENCE_PATTERN);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return content.slice(start, end + 1);
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry);
}

function asIssueList(value: unknown): { issue: string; impact: string; evidence: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is RawReviewIssue => entry !== null && typeof entry === "object")
    .map((entry) => ({
      issue: typeof entry.issue === "string" ? entry.issue : "",
      impact: typeof entry.impact === "string" ? entry.impact : "",
      evidence: typeof entry.evidence === "string" ? entry.evidence : "",
    }));
}

function normalizeReport(raw: RawReviewReport): ReviewReport | null {
  if (typeof raw.status !== "string") return null;
  const status = raw.status as ReviewReportStatus;
  if (status !== "approved" && status !== "changes_required" && status !== "blocked") {
    return null;
  }

  const score = typeof raw.score === "number" ? raw.score : 0;

  return {
    status,
    score,
    criticalIssues: asIssueList(raw.criticalIssues ?? raw.critical_issues),
    majorIssues: asIssueList(raw.majorIssues ?? raw.major_issues),
    minorIssues: asIssueList(raw.minorIssues ?? raw.minor_issues),
    requiredChanges: asStringArray(raw.requiredChanges ?? raw.required_changes),
    finalRecommendation:
      typeof (raw.finalRecommendation ?? raw.final_recommendation) === "string"
        ? String(raw.finalRecommendation ?? raw.final_recommendation)
        : "",
  };
}

export function parseReviewReport(content: string): ReviewReport {
  const jsonText = extractJsonObject(content);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as RawReviewReport;
      const normalized = normalizeReport(parsed);
      if (normalized) {
        return reviewReportSchema.parse(normalized);
      }
    } catch {
      // fall through to unparseable handling
    }
  }

  return {
    status: "blocked",
    score: 0,
    criticalIssues: [],
    majorIssues: [],
    minorIssues: [],
    requiredChanges: [],
    finalRecommendation:
      "Review agent returned an unparseable report; treating the candidate as not approved.",
  };
}

export function createReviewReport(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return reviewReportSchema.parse({
    status: overrides.status ?? "blocked",
    score: overrides.score ?? 0,
    criticalIssues: overrides.criticalIssues ?? [],
    majorIssues: overrides.majorIssues ?? [],
    minorIssues: overrides.minorIssues ?? [],
    requiredChanges: overrides.requiredChanges ?? [],
    finalRecommendation: overrides.finalRecommendation ?? "",
  });
}
