import type { UiUpdate } from "../generative-ui/index.ts";
import type { AgentInputMessage, AgentResult, Attempt } from "./types.ts";

export function buildHistory(
  messages: AgentInputMessage[],
  attempt: Attempt,
  hadRepair: boolean,
  committedUpdates: UiUpdate[],
  structuredOutput: unknown,
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

export function assistantHistoryMessage(
  content: string,
  result: AgentResult | null,
): AgentInputMessage {
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
