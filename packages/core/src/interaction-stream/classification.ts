import {
  type A2UIValidationError,
  type ClassifiedUpdates,
  classifyUpdateText,
  type ModelUiOutput,
  normalizeModelUiOutput,
  type RejectedUiCandidate,
  safeEmit,
  type UiUpdate,
  validateModelUiOutput,
  validateUpdate,
} from "../generative-ui/index.ts";
import { CORE_PROMPT_TEMPLATES } from "../prompts/index.ts";
import type { Attempt, InteractionStreamFailure } from "./types.ts";

export const UNRENDERABLE_UI_MESSAGE =
  "I could not render that as an interactive UI, but I can try again with a simpler layout.";

const MAX_REJECTED_LINES = 8;
const MAX_ISSUES_PER_LINE = 10;
const MAX_FEEDBACK_BYTES = 8 * 1024;

const feedbackEncoder = new TextEncoder();

function byteLength(text: string): number {
  return feedbackEncoder.encode(text).length;
}

export function classifyModelUiOutput(output: ModelUiOutput): ClassifiedUpdates {
  const accepted: UiUpdate[] = [];
  const rejectedUiCandidates: RejectedUiCandidate[] = [];
  for (const update of output.updates) {
    if (update.type === "message") {
      const serializedOutput = parseSerializedModelUiOutput(update.text);
      if (serializedOutput.matched) {
        const nestedOutput = normalizeModelUiOutput(serializedOutput.value);
        const nestedClassification = nestedOutput
          ? classifyModelUiOutput(nestedOutput)
          : classifyInvalidModelUiOutput(serializedOutput.value);
        accepted.push(...nestedClassification.accepted);
        rejectedUiCandidates.push(...nestedClassification.rejectedUiCandidates);
        continue;
      }
    }
    const result = validateUpdate(update);
    if (result.ok) {
      accepted.push(result.update);
    } else if (update.type === "ui") {
      rejectedUiCandidates.push({ line: JSON.stringify(update), issues: result.issues });
    }
  }
  return { accepted, rejectedUiCandidates };
}

function parseSerializedModelUiOutput(
  text: string,
): { matched: false } | { matched: true; value: unknown } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { matched: false };
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("version" in value) ||
    !("updates" in value)
  ) {
    return { matched: false };
  }
  return { matched: true, value };
}

export function classifyInvalidModelUiOutput(value: unknown): ClassifiedUpdates {
  const result = validateModelUiOutput(value);
  const mostSpecificIssue = result.ok
    ? undefined
    : result.issues.reduce<A2UIValidationError | undefined>((best, issue) => {
        const normalized = {
          ...issue,
          path: issue.path.startsWith("$.") ? issue.path.slice(2) : issue.path,
          code: "invalid_model_output",
        } satisfies A2UIValidationError;
        return !best || normalized.path.length > best.path.length ? normalized : best;
      }, undefined);
  const issues = mostSpecificIssue ? [mostSpecificIssue] : [];
  return {
    accepted: [],
    rejectedUiCandidates: [
      {
        line: stringifyForFeedback(value),
        issues:
          issues.length > 0
            ? issues
            : [
                {
                  path: "$",
                  code: "invalid_model_output",
                  message: "The model response did not match the required JSON object.",
                },
              ],
      },
    ],
  };
}

export function classifyUpdateTextForAttempt(finalText: string): ClassifiedUpdates {
  return classifyUpdateText(finalText);
}

export function failureFromAttempt(attempt: Attempt, attempts: number): InteractionStreamFailure {
  const issues = attempt.classification.rejectedUiCandidates.flatMap(
    (candidate) => candidate.issues,
  );
  return {
    attempts,
    code: issues.some((issue) => issue.code !== "invalid_model_output")
      ? "invalid_ui_spec"
      : "invalid_model_output",
    issues,
  };
}

export function messageFallbackFor(finalText: string, uiIntended: boolean): UiUpdate {
  if (uiIntended) {
    return { type: "message", text: UNRENDERABLE_UI_MESSAGE };
  }
  return finalTextToMessageFallback(finalText);
}

export function finalTextToMessageFallback(finalText: string): UiUpdate {
  return {
    type: "message",
    text: finalTextToAssistantContent(finalText),
  };
}

export function finalTextToAssistantContent(finalText: string): string {
  const text = finalText.trim();
  return text || UNRENDERABLE_UI_MESSAGE;
}

export function dedupeUiUpdatesByRoot(updates: UiUpdate[]): UiUpdate[] {
  const lastIndexByRoot = new Map<string, number>();
  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index];
    if (update?.type === "ui") {
      lastIndexByRoot.set(update.rootId ?? update.components[0]?.id ?? "", index);
    }
  }
  return updates.filter(
    (update, index) =>
      update.type !== "ui" ||
      lastIndexByRoot.get(update.rootId ?? update.components[0]?.id ?? "") === index,
  );
}

export function emitUpdates(updates: UiUpdate[], onUpdate: (update: UiUpdate) => void): void {
  for (const update of updates) {
    onUpdate(update);
  }
}

export function attemptedOutputContent(attempt: Attempt): string | null {
  if (attempt.hasStructuredResponse) {
    return stringifyForFeedback(attempt.result?.structuredResponse);
  }
  return attempt.finalText.trim() || null;
}

function stringifyForFeedback(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function buildRepairFeedback(candidates: RejectedUiCandidate[]): string {
  const header = CORE_PROMPT_TEMPLATES.uiRepairFeedback.trim();
  const blocks: string[] = [header];
  let size = byteLength(header);
  const capped = candidates.slice(0, MAX_REJECTED_LINES);
  for (let index = 0; index < capped.length; index += 1) {
    const candidate = capped[index];
    if (!candidate) {
      break;
    }
    const block = formatRejectedCandidate(index + 1, candidate);
    const blockSize = byteLength(block);
    if (size + blockSize > MAX_FEEDBACK_BYTES) {
      break;
    }
    blocks.push(block);
    size += blockSize;
  }
  return blocks.join("\n\n");
}

function formatRejectedCandidate(index: number, candidate: RejectedUiCandidate): string {
  const issues = candidate.issues
    .slice(0, MAX_ISSUES_PER_LINE)
    .map((issue) => `  - ${issue.path}: ${issue.message} (${issue.code})`);
  return `Rejected update ${index}:\n${candidate.line}\nIssues:\n${issues.join("\n")}`;
}

export { safeEmit };
