import type { ClarificationResult } from "../clarification/index.ts";
import type { A2UIValidationError } from "./errors.ts";
import type { UiQuestion, UiQuestionOption, UiSpec, UiUpdate, UiZone } from "./types.ts";
import { validateUpdate } from "./validator.ts";

export type QuestionUpdate = Extract<UiUpdate, { type: "question" }>;
export type UiSpecUpdate = Extract<UiUpdate, { type: "ui" }>;

export function parseUpdateLine(line: string): UiUpdate | null {
  try {
    return normalizeUiUpdate(JSON.parse(line));
  } catch {
    return null;
  }
}

export type UpdateHandlers = {
  onMessage: (text: string) => void;
  onQuestion?: (question: UiQuestion) => void;
  onSpec: (spec: UiSpec) => void;
  onError: (message: string) => void;
  onMainAgentActivity?: (update: Extract<UiUpdate, { type: "main_agent_activity" }>) => void;
  onSubagentActivity?: (update: Extract<UiUpdate, { type: "subagent_activity" }>) => void;
};

export function applyUiUpdate(update: UiUpdate, handlers: UpdateHandlers): void {
  switch (update.type) {
    case "message":
      handlers.onMessage(update.text);
      break;
    case "question":
      handlers.onQuestion?.(update.question);
      break;
    case "ui":
      handlers.onSpec({ components: update.components, rootId: update.rootId });
      break;
    case "error":
      handlers.onError(update.message);
      break;
    case "main_agent_activity":
      handlers.onMainAgentActivity?.(update);
      break;
    case "subagent_activity":
      handlers.onSubagentActivity?.(update);
      break;
  }
}

export function uiUpdateZone(update: UiUpdate): UiZone {
  return update.type === "ui" ||
    update.type === "main_agent_activity" ||
    update.type === "subagent_activity"
    ? "interaction"
    : "chat";
}

export function normalizeQuestionOption(option: UiQuestionOption): {
  label: string;
  description?: string;
  recommended?: boolean;
} {
  if (typeof option === "string") return { label: option };
  return {
    label: option.label,
    ...(option.description ? { description: option.description } : {}),
    ...(option.recommended ? { recommended: true } : {}),
  };
}

export function normalizeUiUpdate(value: unknown): UiUpdate | null {
  const result = validateUpdate(value);
  return result.ok ? result.update : null;
}

export function clarificationResultToQuestionUpdates(
  result: ClarificationResult,
): QuestionUpdate[] {
  if (result.status !== "needs_clarification") return [];

  return result.questions.map((question) => {
    const options = question.options ?? [];
    if (options.length > 0) {
      return {
        type: "question",
        question: {
          id: question.id,
          prompt: question.question,
          kind: "multiple_choice",
          options: options.map((option) => ({
            label: option.label,
            ...(option.description ? { description: option.description } : {}),
            ...(option.recommended ? { recommended: true } : {}),
          })) satisfies UiQuestionOption[],
        },
      };
    }
    return {
      type: "question",
      question: { id: question.id, prompt: question.question, kind: "open_text" },
    };
  });
}

export class StreamingLineBuffer {
  #tail = "";

  push(chunk: string): string[] {
    const parts = (this.#tail + chunk).split("\n");
    this.#tail = parts.pop() ?? "";
    return parts;
  }

  flush(): string[] {
    if (this.#tail === "") return [];
    const tail = this.#tail;
    this.#tail = "";
    return [tail];
  }
}

export type RejectedUiCandidate = {
  line: string;
  issues: A2UIValidationError[];
};

export type ClassifiedUpdates = {
  accepted: UiUpdate[];
  rejectedUiCandidates: RejectedUiCandidate[];
};

export function classifyUpdateText(text: string): ClassifiedUpdates {
  const accepted: UiUpdate[] = [];
  const rejectedUiCandidates: RejectedUiCandidate[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    let candidate: unknown;
    try {
      candidate = JSON.parse(line);
    } catch {
      if (/"type"\s*:\s*"ui"/.test(line)) {
        rejectedUiCandidates.push({
          line,
          issues: [{ path: "$", code: "invalid_json", message: "This line is not valid JSON." }],
        });
      }
      continue;
    }

    const result = validateUpdate(candidate);
    if (result.ok) {
      accepted.push(result.update);
    } else if (
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { type?: unknown }).type === "ui"
    ) {
      rejectedUiCandidates.push({ line, issues: result.issues });
    }
  }

  return { accepted, rejectedUiCandidates };
}

export function parseUpdateText(text: string): UiUpdate[] {
  return classifyUpdateText(text).accepted;
}
