import type { AgentInputMessage } from "@deep-agent-template/core/interaction-stream";

import { createCurrentContext } from "../current-context.ts";

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
