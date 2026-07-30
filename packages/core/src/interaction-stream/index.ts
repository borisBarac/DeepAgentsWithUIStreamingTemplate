import { normalizeModelUiOutput, safeEmit, type UiUpdate } from "../generative-ui/index.ts";
import { hasStructuredOutputParsingCause } from "../scaffold/structured-json.ts";
import { AsyncUpdateQueue } from "./async-update-queue.ts";
import {
  attemptedOutputContent,
  buildRepairFeedback,
  classifyInvalidModelUiOutput,
  classifyModelUiOutput,
  classifyUpdateTextForAttempt,
  dedupeUiUpdatesByRoot,
  emitUpdates,
  failureFromAttempt,
  finalTextToMessageFallback,
  messageFallbackFor,
  UNRENDERABLE_UI_MESSAGE,
} from "./classification.ts";
import { assistantHistoryMessage, buildHistory } from "./history.ts";
import { streamWithEvents } from "./streaming.ts";
import type {
  AgentInputMessage,
  AgentResult,
  Attempt,
  ClassifiedUpdates,
  InteractionStream,
  InteractionStreamOptions,
  InteractionStreamResult,
} from "./types.ts";

export type {
  A2UIValidationError,
  AgentInputMessage,
  AgentResult,
  ClassifiedUpdates,
  InteractionStream,
  InteractionStreamFailure,
  InteractionStreamOptions,
  InteractionStreamResult,
  ModelUiOutput,
  StreamableAgent,
  UiUpdate,
} from "./types.ts";

export { finalTextToMessageFallback, UNRENDERABLE_UI_MESSAGE };

type RunAttemptOnUpdate = (update: UiUpdate) => void;

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
  onUpdate: RunAttemptOnUpdate,
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
  const mainClassification: ClassifiedUpdates = structuredOutput
    ? classifyModelUiOutput(structuredOutput)
    : hasStructuredResponse
      ? classifyInvalidModelUiOutput(result?.structuredResponse)
      : classifyUpdateTextForAttempt(finalText);
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
