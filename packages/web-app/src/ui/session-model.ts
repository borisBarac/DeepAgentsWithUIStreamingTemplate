import type {
  A2UIValidationResult,
  ModelUiOutput,
  UiUpdate,
} from "@deep-agent-template/core/generative-ui/types";
import type { Spec } from "@json-render/core";

import { componentInstancesToSpec } from "./spec-adapter.ts";
import type { ChatMessage } from "./types.ts";
import { parseClientUpdateLine, validateClientModelUiOutput } from "./validate-spec.ts";

export type QualificationQuestion = Extract<UiUpdate, { type: "question" }>["question"];
export type MainAgentActivityUpdate = Extract<UiUpdate, { type: "main_agent_activity" }>;
export type SubagentActivityUpdate = Extract<UiUpdate, { type: "subagent_activity" }>;

export type DisplayMessage = ChatMessage & {
  id: string;
  answer?: string;
  answered?: boolean;
  question?: QualificationQuestion;
  streaming?: boolean;
};

export type DisplayAgentActivity = (MainAgentActivityUpdate | SubagentActivityUpdate) & {
  id: string;
  rawText?: string;
};

export type DisplayUiSpec = {
  id: string;
  spec: Spec;
};

export type AgentChatUpdateHandlers = {
  onMessage: (text: string) => void;
  onQuestion?: (question: QualificationQuestion) => void;
  onSpec: (spec: Spec) => void;
  onError: (message: string) => void;
  onMainAgentActivity?: (update: MainAgentActivityUpdate) => void;
  onSubagentActivity?: (update: SubagentActivityUpdate) => void;
};

export function applyAgentChatUpdate(update: UiUpdate, handlers: AgentChatUpdateHandlers): void {
  switch (update.type) {
    case "message":
      handlers.onMessage(update.text);
      break;
    case "question":
      handlers.onQuestion?.(update.question);
      break;
    case "ui":
      handlers.onSpec(componentInstancesToSpec(update.components, update.rootId));
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

export function applyAgentChatLine(
  line: string,
  handlers: AgentChatUpdateHandlers,
): A2UIValidationResult {
  const result = parseClientUpdateLine(line);
  if (result.ok) {
    applyAgentChatUpdate(result.update, handlers);
  } else {
    handlers.onError(result.issues[0]?.message ?? "UI update was rejected by the validator.");
  }
  return result;
}

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isFinishedActivity(activity: DisplayAgentActivity): boolean {
  return activity.event === "completed" || activity.event === "error";
}

function sameActivityStream(
  activity: DisplayAgentActivity,
  update: MainAgentActivityUpdate | SubagentActivityUpdate,
): boolean {
  if (activity.type !== update.type || isFinishedActivity(activity)) {
    return false;
  }

  if (activity.type === "main_agent_activity" && update.type === "main_agent_activity") {
    return true;
  }

  if (activity.type === "subagent_activity" && update.type === "subagent_activity") {
    if (activity.subagentRunId || update.subagentRunId) {
      return activity.subagentRunId === update.subagentRunId;
    }
    return activity.subagentName === update.subagentName;
  }

  return false;
}

function mergeActivity(
  current: DisplayAgentActivity,
  update: MainAgentActivityUpdate | SubagentActivityUpdate,
): DisplayAgentActivity {
  if (current.type === "subagent_activity" && update.type === "subagent_activity") {
    const rawText = update.text
      ? appendChunk(current.rawText ?? current.text ?? "", update.text)
      : current.rawText;
    const preview = rawText ? previewSubagentTextFromActivity(rawText) : current.text;
    return {
      ...current,
      ...update,
      rawText,
      text: preview ?? current.text,
      message: update.message ?? current.message,
    };
  }

  if (current.type === "main_agent_activity" && update.type === "main_agent_activity") {
    const rawText = update.text
      ? appendChunk(current.rawText ?? current.text ?? "", update.text)
      : current.rawText;
    const preview = rawText ? previewAssistantTextFromActivity(rawText) : current.text;
    return {
      ...current,
      ...update,
      rawText,
      text: preview || undefined,
      message: update.message ?? current.message,
    };
  }

  return { ...current, ...update };
}

export function appendAgentActivity(
  current: DisplayAgentActivity[],
  update: MainAgentActivityUpdate | SubagentActivityUpdate,
  id = createId(),
): DisplayAgentActivity[] {
  const existingById = current.findIndex((activity) => activity.id === id);
  if (existingById !== -1) {
    return current.map((activity, activityIndex) =>
      activityIndex === existingById ? mergeActivity(activity, update) : activity,
    );
  }

  if (update.event === "started") {
    return [...current, { ...update, id }];
  }

  const index = current.findLastIndex((activity) => sameActivityStream(activity, update));
  if (index === -1) {
    return [...current, { ...update, id }];
  }

  return current.map((activity, activityIndex) =>
    activityIndex === index ? mergeActivity(activity, update) : activity,
  );
}

export function appendChunk(current: string, delta: string): string {
  return `${current}${delta}`;
}

export function previewAssistantTextFromActivity(raw: string): string {
  let modelOutput: ModelUiOutput | null = null;
  try {
    const parsedOutput: unknown = JSON.parse(raw);
    const result = validateClientModelUiOutput(parsedOutput);
    modelOutput = result.ok ? result.output : null;
  } catch {
    // The streamed value may be incomplete or use the legacy line format.
  }
  const updates =
    modelOutput?.updates ??
    raw
      .split("\n")
      .map((line) => parseClientUpdateLine(line.trim()))
      .flatMap((result) => (result.ok ? [result.update] : []));
  const parsedMessages = updates
    .flatMap((update) =>
      update &&
      typeof update === "object" &&
      "type" in update &&
      update.type === "message" &&
      "text" in update &&
      typeof update.text === "string"
        ? [update.text]
        : [],
    )
    .map((text) => text.trim())
    .filter(Boolean);

  if (parsedMessages.length > 0) {
    return parsedMessages.join("\n");
  }

  const firstStructuredLine = raw.search(/\s*\{/);
  if (firstStructuredLine === 0) {
    return "";
  }

  return (firstStructuredLine === -1 ? raw : raw.slice(0, firstStructuredLine)).trim();
}

/**
 * Previews a subagent activity delta. Subagent output is often a structured
 * JSON object (e.g. a clarifier result envelope or a reviewer report) that
 * should not be dumped raw into the debug pane. This function extracts any
 * embedded human-readable prose (`reasoningSummary`, `message`, `text`, or
 * `finalRecommendation` fields) and falls back to a short label when only
 * structured content is present.
 *
 * Mirrors {@link previewAssistantTextFromActivity} but tolerates the broader
 * JSON shapes a subagent emits (clarifier results, review reports, etc.).
 */
export function previewSubagentTextFromActivity(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const proseFromObject = (value: unknown): string | undefined => {
    if (typeof value === "string") return value.trim() || undefined;
    if (Array.isArray(value) || value === null || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    const candidates = ["reasoningSummary", "message", "text", "finalRecommendation", "summary"];
    for (const key of candidates) {
      const field = record[key];
      if (typeof field === "string" && field.trim()) return field.trim();
    }
    return undefined;
  };

  // Try parsing the whole delta as JSON first.
  let parsedAll: unknown;
  try {
    parsedAll = JSON.parse(trimmed);
  } catch {
    // Not a single JSON object; fall through to per-line scan.
  }
  if (parsedAll !== undefined) {
    const direct = proseFromObject(parsedAll);
    if (direct) return direct;
    // Recognised structured subagent output (clarifier/reviewer envelopes)
    // renders as a short label instead of the raw JSON dump.
    if (typeof parsedAll === "object" && parsedAll !== null) {
      const record = parsedAll as Record<string, unknown>;
      if (Array.isArray(record.questions)) return "<structured clarifier output>";
      if (
        "criticalIssues" in record ||
        "majorIssues" in record ||
        "minorIssues" in record ||
        "score" in record
      )
        return "<structured reviewer output>";
      if ("deliverables" in record || "candidateFinalResponse" in record)
        return "<structured execution output>";
    }
    return "";
  }

  // Scan line-by-line: keep prose lines, summarize JSON-object lines.
  const lines = trimmed.split("\n");
  const prose: string[] = [];
  for (const line of lines) {
    const lineTrim = line.trim();
    if (!lineTrim) continue;
    if (lineTrim.startsWith("{") || lineTrim.startsWith("[")) {
      let lineValue: unknown;
      try {
        lineValue = JSON.parse(lineTrim);
      } catch {
        // Treat as prose if it cannot be parsed.
        prose.push(lineTrim);
        continue;
      }
      const direct = proseFromObject(lineValue);
      if (direct) {
        prose.push(direct);
      }
      continue;
    }
    prose.push(lineTrim);
  }
  if (prose.length > 0) return prose.join("\n");
  return "";
}

function updateAssistantMessage(
  current: DisplayMessage[],
  text: string,
  id: string,
  combine: (existing: string, incoming: string) => string,
): DisplayMessage[] {
  const index = current.findIndex((message) => message.id === id);
  if (index === -1) {
    return [...current, { role: "assistant", content: text, id, streaming: true }];
  }

  return current.map((message, messageIndex) =>
    messageIndex === index
      ? { ...message, content: combine(message.content, text), streaming: true }
      : message,
  );
}

export function appendAssistantChunk(
  current: DisplayMessage[],
  text: string,
  id: string,
): DisplayMessage[] {
  return updateAssistantMessage(current, text, id, appendChunk);
}

export function replaceAssistantMessage(
  current: DisplayMessage[],
  text: string,
  id: string,
): DisplayMessage[] {
  return updateAssistantMessage(current, text, id, () => text);
}

export function finishAssistantMessage(
  current: DisplayMessage[],
  id: string | null,
): DisplayMessage[] {
  if (!id) {
    return current;
  }

  return current.flatMap((message) => {
    if (message.id !== id) {
      return [message];
    }

    const content = message.content.trim();
    return content ? [{ ...message, content, streaming: undefined }] : [];
  });
}

export function formatQuestionAnswers(
  messages: readonly DisplayMessage[],
  answers: ReadonlyMap<string, string>,
  questionIds: ReadonlySet<string>,
): string {
  const lines = messages.flatMap((message) => {
    const question = message.question;
    const answer = question ? answers.get(question.id)?.trim() : undefined;
    return question && questionIds.has(question.id) && answer
      ? [`- ${question.prompt}: ${answer}`]
      : [];
  });

  return lines.length > 0 ? `Here are my answers:\n${lines.join("\n")}` : "";
}

export function appendUiSpec(
  current: readonly DisplayUiSpec[],
  spec: Spec,
  id = createId(),
): DisplayUiSpec[] {
  const existingIndex = current.findIndex((entry) => entry.spec.root === spec.root);
  const isCanonicalProductGrid = Object.values(spec.elements).some(
    (element) => element.type === "ProductGrid",
  );
  if (isCanonicalProductGrid) {
    const existing = existingIndex === -1 ? undefined : current[existingIndex];
    const withoutProductSpecs = current.filter(
      (entry) =>
        !Object.values(entry.spec.elements).some((element) =>
          ["ProductGrid", "ProductCard"].includes(String(element.type)),
        ),
    );
    return [...withoutProductSpecs, { id: existing?.id ?? id, spec }];
  }
  if (existingIndex === -1) {
    return [...current, { id, spec }];
  }
  return current.map((entry, index) => (index === existingIndex ? { ...entry, spec } : entry));
}
