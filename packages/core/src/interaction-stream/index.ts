import { StructuredOutputParsingError } from "langchain";

import {
  type ClassifiedUpdates,
  classifyUpdateText,
  type ModelUiOutput,
  modelUiOutputSchema,
  type NormalizeSpec,
  normalizeModelUiOutput,
  normalizeSpecToValidateSpec,
  normalizeUiUpdate,
  productCardBatchSchema,
  productCardsToUiUpdates,
  type RejectedUiCandidate,
  type UiUpdate,
  type ValidateSpec,
} from "../generative-ui/index.ts";
import { CORE_PROMPT_TEMPLATES } from "../prompts/index.ts";

export type {
  ClassifiedUpdates,
  ModelUiOutput,
  SpecValidationIssue,
  SpecValidationResult,
  UiUpdate,
  ValidateSpec,
} from "../generative-ui/index.ts";

export type AgentInputMessage = {
  content: string;
  role: "assistant" | "user";
};

export type AgentResult = {
  messages?: unknown[];
  structuredResponse?: unknown;
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
  normalizeSpec?: NormalizeSpec;
  requireStructuredOutput?: boolean;
  sessionId: string;
  validateSpec?: ValidateSpec;
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
  issues: Array<{ code: string; message: string; path: string }>;
};

export type InteractionStream = {
  result: Promise<InteractionStreamResult>;
  updates: AsyncIterable<UiUpdate>;
};

export const UNRENDERABLE_UI_MESSAGE =
  "I could not render that as an interactive UI, but I can try again with a simpler product-card layout.";

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
      const streamResult = await runInteraction(options, (update) => {
        queue.push(update);
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

export function productBatchTextToUiUpdates(
  text: string,
  normalizeSpec?: NormalizeSpec,
): UiUpdate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  return productBatchValueToUiUpdates(parsed, normalizeSpec);
}

function productBatchValueToUiUpdates(value: unknown, normalizeSpec?: NormalizeSpec): UiUpdate[] {
  const batch = productCardBatchSchema.safeParse(value);
  if (!batch.success) {
    return [];
  }

  return productCardsToUiUpdates(batch.data.products).flatMap((candidate) => {
    const update = normalizeUiUpdate(candidate, normalizeSpec);
    return update ? [update] : [];
  });
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
  const validateSpec = resolveValidator(options);

  const attempt1 = await runAttempt(options.messages, options, validateSpec, onUpdate);
  let lastAttempt: Attempt = attempt1;
  let hadRepair = false;

  if (attempt1.classification.rejectedUiCandidates.length > 0) {
    const feedback = buildRepairFeedback(attempt1.classification.rejectedUiCandidates);
    const attemptedOutput = attemptedOutputContent(attempt1);
    const repairMessages: AgentInputMessage[] = [
      ...options.messages,
      ...(attemptedOutput
        ? ([{ content: attemptedOutput, role: "assistant" }] satisfies AgentInputMessage[])
        : []),
      { content: feedback, role: "user" },
    ];
    lastAttempt = await runAttempt(repairMessages, options, validateSpec, onUpdate);
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
    ),
    result: lastAttempt.result,
    structuredOutput,
  };
}

function resolveValidator(options: InteractionStreamOptions): ValidateSpec | undefined {
  if (options.validateSpec) {
    return options.validateSpec;
  }
  if (options.normalizeSpec) {
    return normalizeSpecToValidateSpec(options.normalizeSpec);
  }
  return undefined;
}

async function runAttempt(
  messages: AgentInputMessage[],
  options: InteractionStreamOptions,
  validateSpec: ValidateSpec | undefined,
  onUpdate: (update: UiUpdate) => void,
): Promise<Attempt> {
  const productUpdates: UiUpdate[] = [];
  let streamResult: { finalText: string; result: AgentResult | null };
  try {
    streamResult = await streamWithEvents(
      options.agent,
      { messages },
      options.sessionId,
      options.includeActivity ? onUpdate : undefined,
      options.includeActivity ? onUpdate : undefined,
      (value) => productUpdates.push(...productBatchValueToUiUpdates(value, options.normalizeSpec)),
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
    ? classifyModelUiOutput(structuredOutput, validateSpec)
    : expectsStructuredOutput
      ? classifyInvalidModelUiOutput(result?.structuredResponse)
      : classifyUpdateText(finalText, validateSpec);
  const legacyProductUpdates = expectsStructuredOutput
    ? []
    : productBatchTextToUiUpdates(finalText, options.normalizeSpec);
  if (
    !expectsStructuredOutput &&
    mainClassification.accepted.length === 0 &&
    mainClassification.rejectedUiCandidates.length === 0 &&
    legacyProductUpdates.length === 0 &&
    finalText.trim()
  ) {
    mainClassification.accepted.push(finalTextToMessageFallback(finalText));
  }
  const accepted = [...productUpdates, ...legacyProductUpdates, ...mainClassification.accepted];
  const rejectedUiCandidates = [...mainClassification.rejectedUiCandidates];
  const classification = { accepted, rejectedUiCandidates };
  return { finalText, result, classification, hasStructuredResponse, structuredOutput };
}

function hasStructuredOutputParsingCause(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current != null && !seen.has(current)) {
    if (current instanceof StructuredOutputParsingError) return true;
    seen.add(current);
    if (typeof current !== "object" || !("cause" in current)) return false;
    current = current.cause;
  }
  return false;
}

function classifyModelUiOutput(
  output: ModelUiOutput,
  validateSpec?: ValidateSpec,
): ClassifiedUpdates {
  const accepted: UiUpdate[] = [];
  const rejectedUiCandidates: RejectedUiCandidate[] = [];
  for (const update of output.updates) {
    if (update.type !== "ui" || !validateSpec) {
      accepted.push(update as UiUpdate);
      continue;
    }
    const result = validateSpec(update.spec);
    if (result.ok) {
      accepted.push({ type: "ui", spec: result.spec });
    } else {
      rejectedUiCandidates.push({ line: JSON.stringify(update), issues: result.issues });
    }
  }
  return { accepted, rejectedUiCandidates };
}

function classifyInvalidModelUiOutput(value: unknown): ClassifiedUpdates {
  const result = modelUiOutputSchema.safeParse(value);
  const issues = result.success
    ? []
    : result.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join(".") : "$",
        code: "invalid_model_output",
        message: issue.message,
      }));
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
): unknown[] {
  if (structuredOutput) {
    return [...messages, { content: JSON.stringify(structuredOutput), role: "assistant" }];
  }
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
    return [...messages, { content: visibleText, role: "assistant" }];
  }
  if (!attempt.hasStructuredResponse && attempt.finalText.trim()) {
    return [...messages, { content: attempt.finalText.trim(), role: "assistant" }];
  }
  return messages;
}

function dedupeUiUpdatesByRoot(updates: UiUpdate[]): UiUpdate[] {
  const lastIndexByRoot = new Map<string, number>();
  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index];
    if (update?.type === "ui") lastIndexByRoot.set(update.spec.root, index);
  }
  return updates.filter(
    (update, index) => update.type !== "ui" || lastIndexByRoot.get(update.spec.root) === index,
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
  onProductBatch?: (value: unknown) => void,
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
      activityStreams.push(drainSubagentActivity(subagent, onSubagentActivity, onProductBatch));
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
  onProductBatch?: (value: unknown) => void,
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

    const output = await subagent.output;
    if (subagentName === "product-generator") {
      const structuredResponse = extractStructuredResponse(output);
      if (structuredResponse !== undefined) {
        onProductBatch?.(structuredResponse);
      } else {
        const text = extractSubagentOutputText(output);
        if (text) {
          try {
            onProductBatch?.(JSON.parse(text));
          } catch {
            // Invalid legacy product output is ignored.
          }
        }
      }
    }
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

function extractStructuredResponse(output: unknown): unknown {
  if (typeof output !== "object" || output === null || !("structuredResponse" in output)) {
    return undefined;
  }
  return output.structuredResponse;
}

function extractSubagentOutputText(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (typeof output !== "object" || output === null) return undefined;
  if ("content" in output) return extractTextContent(output.content);
  if ("messages" in output) return extractFinalResponse(output as AgentResult);
  return undefined;
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
