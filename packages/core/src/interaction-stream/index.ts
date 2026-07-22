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
import { hasStructuredOutputParsingCause } from "../scaffold/structured-json.ts";

export type {
  A2UIValidationError,
  ClassifiedUpdates,
  ModelUiOutput,
  UiUpdate,
} from "../generative-ui/index.ts";

export type AgentInputMessage = {
  additional_kwargs?: Record<string, unknown>;
  content: string;
  role: "assistant" | "user";
};

export type AgentResult = {
  messages?: unknown[];
  structuredResponse?: unknown;
  workResult?: unknown;
};

type StreamTextMessage = {
  text: AsyncIterable<string>;
};

type StreamSubagent = {
  name?: unknown;
  subagentName?: unknown;
  taskInput?: unknown;
  messages?: AsyncIterable<StreamTextMessage>;
  output?: Promise<unknown>;
};

export type StreamableAgent = {
  invoke: (input: { messages: AgentInputMessage[] }) => Promise<unknown>;
  streamEvents?: (
    input: { messages: AgentInputMessage[] },
    config: { configurable: { thread_id: string }; version: "v3" },
  ) => Promise<{
    messages: AsyncIterable<StreamTextMessage>;
    subagents?: AsyncIterable<StreamSubagent>;
    output: Promise<AgentResult>;
  }>;
};

export type InteractionStreamOptions = {
  agent: StreamableAgent;
  includeActivity?: boolean;
  messages: AgentInputMessage[];
  requireStructuredOutput?: boolean;
  sessionId: string;
};

export type InteractionStreamResult = {
  failure: InteractionStreamFailure | null;
  finalText: string;
  history: unknown[];
  result: AgentResult | null;
  structuredOutput: ModelUiOutput | null;
};

export type InteractionStreamFailure = {
  attempts: number;
  code: "invalid_model_output" | "invalid_ui_spec";
  issues: A2UIValidationError[];
};

export type InteractionStream = {
  result: Promise<InteractionStreamResult>;
  updates: AsyncIterable<UiUpdate>;
};

export const UNRENDERABLE_UI_MESSAGE =
  "I could not render that as an interactive UI, but I can try again with a simpler layout.";

export function createInteractionStream(options: InteractionStreamOptions): InteractionStream {
  const queue = new AsyncUpdateQueue();
  let resolveResult!: (result: InteractionStreamResult) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<InteractionStreamResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  void (async () => {
    try {
      const streamResult = await runInteraction(options, (candidate) => {
        const emitted = safeEmit(candidate, { strict: true });
        if (emitted.ok) queue.push(emitted.update);
      });
      resolveResult(streamResult);
      queue.close();
    } catch (error) {
      rejectResult(error);
      queue.throw(error);
    }
  })();

  return {
    result,
    updates: queue,
  };
}

class AsyncUpdateQueue implements AsyncIterable<UiUpdate> {
  #closed = false;
  #error: unknown;
  #queue: UiUpdate[] = [];
  #waiter: (() => void) | undefined;

  push(update: UiUpdate): void {
    if (this.#closed) return;
    this.#queue.push(update);
    this.#waiter?.();
    this.#waiter = undefined;
  }

  close(): void {
    this.#closed = true;
    this.#waiter?.();
    this.#waiter = undefined;
  }

  throw(error: unknown): void {
    this.#error = error;
    this.close();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<UiUpdate> {
    while (true) {
      if (this.#queue.length > 0) {
        yield this.#queue.shift() as UiUpdate;
        continue;
      }
      if (this.#error) {
        throw this.#error;
      }
      if (this.#closed) {
        return;
      }
      await new Promise<void>((resolve) => {
        this.#waiter = resolve;
      });
    }
  }
}

export function finalTextToMessageFallback(finalText: string): UiUpdate {
  return {
    type: "message",
    text: finalTextToAssistantContent(finalText),
  };
}

const MAX_REJECTED_LINES = 8;
const MAX_ISSUES_PER_LINE = 10;
const MAX_FEEDBACK_BYTES = 8 * 1024;

type Attempt = {
  finalText: string;
  result: AgentResult | null;
  classification: ClassifiedUpdates;
  hasStructuredResponse: boolean;
  structuredOutput: ModelUiOutput | null;
};

async function runInteraction(
  options: InteractionStreamOptions,
  onUpdate: (update: UiUpdate) => void,
): Promise<InteractionStreamResult> {
  const attempt1 = await runAttempt(options.messages, options, onUpdate);
  let lastAttempt: Attempt = attempt1;
  let hadRepair = false;

  if (attempt1.classification.rejectedUiCandidates.length > 0) {
    const feedback = buildRepairFeedback(attempt1.classification.rejectedUiCandidates);
    const attemptedOutput = attemptedOutputContent(attempt1);
    const repairMessages: AgentInputMessage[] = [
      ...options.messages,
      ...(attemptedOutput
        ? ([
            assistantHistoryMessage(attemptedOutput, attempt1.result),
          ] satisfies AgentInputMessage[])
        : []),
      { content: feedback, role: "user" },
    ];
    lastAttempt = await runAttempt(repairMessages, options, onUpdate);
    hadRepair = true;
  }

  const stillRejected = lastAttempt.classification.rejectedUiCandidates.length > 0;
  const committedUpdates = dedupeUiUpdatesByRoot(
    stillRejected
      ? [{ type: "message", text: UNRENDERABLE_UI_MESSAGE } satisfies UiUpdate]
      : lastAttempt.classification.accepted.length > 0
        ? lastAttempt.classification.accepted
        : [messageFallbackFor(lastAttempt.finalText, false)],
  );
  emitUpdates(committedUpdates, onUpdate);

  const structuredOutput =
    stillRejected || lastAttempt.structuredOutput === null
      ? null
      : normalizeModelUiOutput({ version: 1, updates: committedUpdates });
  const failure = stillRejected ? failureFromAttempt(lastAttempt, hadRepair ? 2 : 1) : null;

  return {
    failure,
    finalText: lastAttempt.finalText,
    history: buildHistory(
      options.messages,
      lastAttempt,
      hadRepair,
      committedUpdates,
      structuredOutput,
      options.requireStructuredOutput === true,
    ),
    result: lastAttempt.result,
    structuredOutput,
  };
}

async function runAttempt(
  messages: AgentInputMessage[],
  options: InteractionStreamOptions,
  onUpdate: (update: UiUpdate) => void,
): Promise<Attempt> {
  let streamResult: { finalText: string; result: AgentResult | null };
  try {
    streamResult = await streamWithEvents(
      options.agent,
      { messages },
      options.sessionId,
      options.includeActivity ? onUpdate : undefined,
      options.includeActivity ? onUpdate : undefined,
    );
  } catch (error) {
    if (!hasStructuredOutputParsingCause(error)) throw error;
    return {
      finalText: "",
      result: null,
      classification: classifyInvalidModelUiOutput(undefined),
      hasStructuredResponse: false,
      structuredOutput: null,
    };
  }
  const { finalText, result } = streamResult;
  const hasStructuredResponse = result?.structuredResponse !== undefined;
  const expectsStructuredOutput = hasStructuredResponse || options.requireStructuredOutput === true;
  const structuredOutput = hasStructuredResponse
    ? normalizeModelUiOutput(result?.structuredResponse)
    : null;
  const mainClassification = structuredOutput
    ? classifyModelUiOutput(structuredOutput)
    : hasStructuredResponse
      ? classifyInvalidModelUiOutput(result?.structuredResponse)
      : classifyUpdateText(finalText);
  if (
    !expectsStructuredOutput &&
    mainClassification.accepted.length === 0 &&
    mainClassification.rejectedUiCandidates.length === 0 &&
    finalText.trim()
  ) {
    mainClassification.accepted.push(finalTextToMessageFallback(finalText));
  }
  const classification = mainClassification;
  return { finalText, result, classification, hasStructuredResponse, structuredOutput };
}

function classifyModelUiOutput(output: ModelUiOutput): ClassifiedUpdates {
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

function classifyInvalidModelUiOutput(value: unknown): ClassifiedUpdates {
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

function failureFromAttempt(attempt: Attempt, attempts: number): InteractionStreamFailure {
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

function messageFallbackFor(finalText: string, uiIntended: boolean): UiUpdate {
  if (uiIntended) {
    return { type: "message", text: UNRENDERABLE_UI_MESSAGE };
  }
  return finalTextToMessageFallback(finalText);
}

function buildHistory(
  messages: AgentInputMessage[],
  attempt: Attempt,
  hadRepair: boolean,
  committedUpdates: UiUpdate[],
  structuredOutput: ModelUiOutput | null,
  requireStructuredOutput: boolean,
): unknown[] {
  const persistentMessages = messages.filter(
    (message) => message.additional_kwargs?.transient_context !== true,
  );
  if (structuredOutput) {
    return [
      ...persistentMessages,
      assistantHistoryMessage(JSON.stringify(structuredOutput), attempt.result),
    ];
  }
  if (requireStructuredOutput) return persistentMessages;
  if (!hadRepair) {
    const outputMessages = attempt.result?.messages;
    if (Array.isArray(outputMessages) && outputMessages.length > 0) {
      return outputMessages;
    }
  }
  const visibleText = committedUpdates
    .filter((update): update is Extract<UiUpdate, { type: "message" }> => update.type === "message")
    .map((update) => update.text.trim())
    .filter(Boolean)
    .join("\n");
  if (visibleText) {
    return [...persistentMessages, assistantHistoryMessage(visibleText, attempt.result)];
  }
  if (!attempt.hasStructuredResponse && attempt.finalText.trim()) {
    return [
      ...persistentMessages,
      assistantHistoryMessage(attempt.finalText.trim(), attempt.result),
    ];
  }
  return persistentMessages;
}

function assistantHistoryMessage(content: string, result: AgentResult | null): AgentInputMessage {
  const reasoningContent = latestReasoningContent(result);
  return {
    ...(reasoningContent === undefined
      ? {}
      : { additional_kwargs: { reasoning_content: reasoningContent } }),
    content,
    role: "assistant",
  };
}

function latestReasoningContent(result: AgentResult | null): unknown {
  const messageLists = [
    result?.messages,
    typeof result?.workResult === "object" && result.workResult !== null
      ? (result.workResult as { messages?: unknown }).messages
      : undefined,
  ];
  for (const messages of messageLists) {
    if (!Array.isArray(messages)) continue;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (typeof message !== "object" || message === null) continue;
      const additionalKwargs = (message as { additional_kwargs?: unknown }).additional_kwargs;
      if (typeof additionalKwargs !== "object" || additionalKwargs === null) continue;
      const reasoningContent = (additionalKwargs as { reasoning_content?: unknown })
        .reasoning_content;
      if (reasoningContent !== undefined) return reasoningContent;
    }
  }
  return undefined;
}

function dedupeUiUpdatesByRoot(updates: UiUpdate[]): UiUpdate[] {
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

const feedbackEncoder = new TextEncoder();

function byteLength(text: string): number {
  return feedbackEncoder.encode(text).length;
}

function buildRepairFeedback(candidates: RejectedUiCandidate[]): string {
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

function emitUpdates(updates: UiUpdate[], onUpdate: (update: UiUpdate) => void): void {
  for (const update of updates) {
    onUpdate(update);
  }
}

function attemptedOutputContent(attempt: Attempt): string | null {
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

async function streamWithEvents(
  agent: StreamableAgent,
  input: { messages: AgentInputMessage[] },
  sessionId: string,
  onMainAgentActivity?: (update: Extract<UiUpdate, { type: "main_agent_activity" }>) => void,
  onSubagentActivity?: (update: Extract<UiUpdate, { type: "subagent_activity" }>) => void,
): Promise<{ finalText: string; result: AgentResult | null }> {
  if (!agent.streamEvents) {
    const result = (await agent.invoke(input)) as AgentResult;
    return { finalText: extractFinalResponse(result), result };
  }

  const run = await agent.streamEvents(input, {
    configurable: { thread_id: sessionId },
    version: "v3",
  });
  let streamedText = "";

  const drainMessages = async () => {
    onMainAgentActivity?.({ type: "main_agent_activity", event: "started" });
    for await (const message of run.messages) {
      for await (const token of message.text) {
        if (!token) {
          continue;
        }
        streamedText += token;
        onMainAgentActivity?.({ type: "main_agent_activity", event: "delta", text: token });
      }
    }
  };

  const drainSubagents = async () => {
    if (!run.subagents) {
      return;
    }

    const activityStreams: Promise<void>[] = [];
    for await (const subagent of run.subagents) {
      activityStreams.push(drainSubagentActivity(subagent, onSubagentActivity));
    }
    await Promise.all(activityStreams);
  };

  const settlements = await Promise.allSettled([run.output, drainMessages(), drainSubagents()]);
  const failure = settlements.find(
    (settlement): settlement is PromiseRejectedResult => settlement.status === "rejected",
  );
  if (failure) {
    const error = failure.reason;
    onMainAgentActivity?.({
      type: "main_agent_activity",
      event: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const output = settlements[0];
  if (output?.status !== "fulfilled") {
    throw new Error("Agent output did not settle.");
  }
  onMainAgentActivity?.({ type: "main_agent_activity", event: "completed" });
  const finalText = extractFinalResponse(output.value) || streamedText;
  return { finalText, result: output.value };
}

async function drainSubagentActivity(
  subagent: StreamSubagent,
  onSubagentActivity?: (update: Extract<UiUpdate, { type: "subagent_activity" }>) => void,
): Promise<void> {
  const subagentName = subagentNameFrom(subagent);
  const subagentRunId = crypto.randomUUID();
  try {
    onSubagentActivity?.({
      type: "subagent_activity",
      subagentRunId,
      subagentName,
      event: "started",
      task: taskInputToText(subagent.taskInput),
    });

    if (subagent.messages) {
      for await (const message of subagent.messages) {
        for await (const token of message.text) {
          if (token) {
            onSubagentActivity?.({
              type: "subagent_activity",
              subagentRunId,
              subagentName,
              event: "delta",
              text: token,
            });
          }
        }
      }
    }

    await subagent.output;
    onSubagentActivity?.({
      type: "subagent_activity",
      subagentRunId,
      subagentName,
      event: "completed",
    });
  } catch (error) {
    onSubagentActivity?.({
      type: "subagent_activity",
      subagentRunId,
      subagentName,
      event: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function extractTextContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (typeof part === "object" && part !== null && "text" in part) {
        return typeof part.text === "string" ? part.text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");

  return text || undefined;
}

function extractFinalResponse(result: AgentResult): string {
  const messages = result.messages;
  if (!Array.isArray(messages)) {
    return "";
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (typeof message !== "object" || message === null || !("content" in message)) {
      continue;
    }

    const content = extractTextContent(message.content);
    if (content) {
      return content;
    }
  }

  return "";
}

function finalTextToAssistantContent(finalText: string): string {
  const text = finalText.trim();
  return text || UNRENDERABLE_UI_MESSAGE;
}

function subagentNameFrom(subagent: StreamSubagent): string {
  if (typeof subagent.subagentName === "string" && subagent.subagentName.trim()) {
    return subagent.subagentName.trim();
  }
  if (typeof subagent.name === "string" && subagent.name.trim()) {
    return subagent.name.trim();
  }
  return "subagent";
}

function taskInputToText(taskInput: unknown): string | undefined {
  if (typeof taskInput === "string") {
    return taskInput.trim() || undefined;
  }
  if (typeof taskInput !== "object" || taskInput === null) {
    return undefined;
  }

  if ("task" in taskInput && typeof taskInput.task === "string") {
    return taskInput.task.trim() || undefined;
  }
  if ("content" in taskInput) {
    return extractTextContent(taskInput.content);
  }
  return undefined;
}
