import type { UiUpdate } from "../generative-ui/index.ts";
import type { AgentInputMessage, AgentResult, StreamableAgent, StreamSubagent } from "./types.ts";

const SUBAGENT_DRAIN_CONCURRENCY = 8;

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

export async function streamWithEvents(
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

  // run.output (the supervisor result) and each subagent.output are independent
  // promises in the type contract: StreamSubagent.output is an optional promise
  // with no type-level link to run.output (see types.ts). In production
  // deepagents the supervisor's task tool awaits each delegated result inline,
  // so a subagent.output normally settles no later than run.output; a rejecting
  // subagent therefore rejects before (or with) the parent and is registered
  // first in the race below, so it surfaces as "error". We still race against
  // run.output settling so a pathological never-settling subagent.output cannot
  // hang streamWithEvents once the parent run is done.
  const parentSettled = run.output.then(
    () => undefined,
    () => undefined,
  );

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

    const executing = new Set<Promise<void>>();
    for await (const subagent of run.subagents) {
      const activity = drainSubagentActivity(subagent, onSubagentActivity, parentSettled);
      executing.add(activity);
      activity.finally(() => {
        executing.delete(activity);
      });
      if (executing.size >= SUBAGENT_DRAIN_CONCURRENCY) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);
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
  parentSettled?: Promise<void>,
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

    // Await the delegated result before reporting completion so a rejection
    // throws into the catch and emits "error" instead of being swallowed. Race
    // against the parent run settling (see comment in streamWithEvents) so a
    // never-settling output cannot hang the stream. When no parent signal is
    // supplied this reduces to awaiting the output directly.
    if (subagent.output) {
      const competitors = parentSettled ? [subagent.output, parentSettled] : [subagent.output];
      await Promise.race(competitors);
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
