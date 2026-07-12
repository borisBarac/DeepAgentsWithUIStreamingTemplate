import {
  classifyUpdateText,
  type NormalizeSpec,
  normalizeSpecToValidateSpec,
  normalizeUiUpdate,
  productCardBatchSchema,
  productCardsToUiUpdates,
  type RejectedUiCandidate,
  type UiUpdate,
  type ValidateSpec,
} from "../generative-ui/index.ts";

export type {
  ClassifiedUpdates,
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
  sessionId: string;
  validateSpec?: ValidateSpec;
};

export type InteractionStreamResult = {
  finalText: string;
  history: unknown[];
  result: AgentResult | null;
};

export type InteractionStream = {
  result: Promise<InteractionStreamResult>;
  updates: AsyncIterable<UiUpdate>;
};

const UNRENDERABLE_UI_MESSAGE =
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

  const batch = productCardBatchSchema.safeParse(parsed);
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
  classification: {
    accepted: UiUpdate[];
    rejectedUiCandidates: RejectedUiCandidate[];
  };
};

async function runInteraction(
  options: InteractionStreamOptions,
  onUpdate: (update: UiUpdate) => void,
): Promise<InteractionStreamResult> {
  const stats = { valid: 0 };
  const validateSpec = resolveValidator(options);

  const attempt1 = await runAttempt(options.messages, options, validateSpec, stats, onUpdate);
  let lastAttempt: Attempt = attempt1;
  let hadRepair = false;

  if (attempt1.classification.rejectedUiCandidates.length > 0) {
    const feedback = buildRepairFeedback(attempt1.classification.rejectedUiCandidates);
    const repairMessages: AgentInputMessage[] = [
      ...options.messages,
      { content: finalTextToAssistantContent(attempt1.finalText), role: "assistant" },
      { content: feedback, role: "user" },
    ];
    lastAttempt = await runAttempt(repairMessages, options, validateSpec, stats, onUpdate);
    hadRepair = true;
  } else if (stats.valid === 0) {
    emitUpdates(
      productBatchTextToUiUpdates(attempt1.finalText, options.normalizeSpec),
      stats,
      onUpdate,
    );
    if (stats.valid === 0) {
      lastAttempt = await runAttempt(options.messages, options, validateSpec, stats, onUpdate);
      emitUpdates(
        productBatchTextToUiUpdates(lastAttempt.finalText, options.normalizeSpec),
        stats,
        onUpdate,
      );
    }
  }

  if (stats.valid === 0) {
    const uiIntended = lastAttempt.classification.rejectedUiCandidates.length > 0;
    emitUpdates([messageFallbackFor(lastAttempt.finalText, uiIntended)], stats, onUpdate);
  }

  return {
    finalText: lastAttempt.finalText,
    history: buildHistory(options.messages, lastAttempt, hadRepair),
    result: lastAttempt.result,
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
  stats: { valid: number },
  onUpdate: (update: UiUpdate) => void,
): Promise<Attempt> {
  const { finalText, result } = await streamWithEvents(
    options.agent,
    { messages },
    options.sessionId,
    options.includeActivity ? onUpdate : undefined,
    options.includeActivity ? onUpdate : undefined,
  );
  const classification = classifyUpdateText(finalText, validateSpec);
  emitUpdates(classification.accepted, stats, onUpdate);
  return { finalText, result, classification };
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
): unknown[] {
  if (!hadRepair) {
    const outputMessages = attempt.result?.messages;
    if (Array.isArray(outputMessages) && outputMessages.length > 0) {
      return outputMessages;
    }
  }
  return [
    ...messages,
    { content: finalTextToAssistantContent(attempt.finalText), role: "assistant" },
  ];
}

const feedbackEncoder = new TextEncoder();

function byteLength(text: string): number {
  return feedbackEncoder.encode(text).length;
}

function buildRepairFeedback(candidates: RejectedUiCandidate[]): string {
  const header =
    'The following UI updates were rejected during validation. Replace ONLY the rejected updates with valid NDJSON. Do not repeat already-accepted updates. If you cannot produce valid UI, respond with a single {"type":"message","text":"..."} update.';
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

function emitUpdates(
  updates: UiUpdate[],
  stats: { valid: number },
  onUpdate: (update: UiUpdate) => void,
): void {
  for (const update of updates) {
    onUpdate(update);
    stats.valid += 1;
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
    if (!run.subagents || !onSubagentActivity) {
      return;
    }

    const activityStreams: Promise<void>[] = [];
    for await (const subagent of run.subagents) {
      activityStreams.push(drainSubagentActivity(subagent, onSubagentActivity));
    }
    await Promise.all(activityStreams);
  };

  try {
    const [result] = await Promise.all([run.output, drainMessages(), drainSubagents()]);
    onMainAgentActivity?.({ type: "main_agent_activity", event: "completed" });
    const finalText = streamedText || extractFinalResponse(result);
    return { finalText, result };
  } catch (error) {
    onMainAgentActivity?.({
      type: "main_agent_activity",
      event: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function drainSubagentActivity(
  subagent: StreamSubagent,
  onSubagentActivity: (update: Extract<UiUpdate, { type: "subagent_activity" }>) => void,
): Promise<void> {
  const subagentName = subagentNameFrom(subagent);
  const subagentRunId = crypto.randomUUID();
  try {
    onSubagentActivity({
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
            onSubagentActivity({
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
    onSubagentActivity({
      type: "subagent_activity",
      subagentRunId,
      subagentName,
      event: "completed",
    });
  } catch (error) {
    onSubagentActivity({
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
