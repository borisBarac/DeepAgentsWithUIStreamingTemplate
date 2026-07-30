import type { AgentInputMessage } from "@deep-agent-template/core/interaction-stream";

import { createCurrentContext } from "../current-context.ts";

// Shared message construction for both inline and queued turns. Builds the
// canonical input sequence: stored history, transient current-context marker,
// then the new user message. Both the inline runner and the BullMQ worker call
// this so the two paths can never drift in how they frame a turn.
export function buildTurnMessages(
  history: readonly unknown[],
  userMessage: string,
): AgentInputMessage[] {
  return [
    ...(history as AgentInputMessage[]),
    {
      additional_kwargs: { transient_context: true },
      content: createCurrentContext(),
      role: "user",
    },
    { content: userMessage, role: "user" },
  ];
}
