import { createCurrentContextPrompt } from "@deep-agent-template/core/prompts";

export function createCurrentContext(now = new Date()): string {
  return createCurrentContextPrompt(now);
}
