import { type CreateDeepAgentParams, type SubAgent } from "deepagents";

import { type ClarificationConfig, clarificationResultSchema, createClarificationConfig } from "../clarification/index.ts";
import { DEFAULT_PROMPT_LOADER, type PromptLoader } from "../prompts/index.ts";
import { CLARIFY_DEEPLY_SKILL_DIR } from "../skills/index.ts";
import type { CreateDefaultSubagentsOptions } from "./types.ts";

function mergeSubagent(base: SubAgent, override: Partial<SubAgent> | undefined): SubAgent {
  if (!override) {
    return base;
  }

  return {
    ...base,
    ...override,
    tools: override.tools ?? base.tools,
    model: override.model ?? base.model,
    middleware: override.middleware ?? base.middleware,
    interruptOn: override.interruptOn ?? base.interruptOn,
    skills: override.skills ?? base.skills,
    responseFormat: override.responseFormat ?? base.responseFormat,
    permissions: override.permissions ?? base.permissions,
  };
}

function createDefaultInterrupts(): NonNullable<CreateDeepAgentParams["interruptOn"]> {
  return {
    write_file: true,
    edit_file: true,
    execute: true,
  };
}

export function createDefaultSubagents(
  options: CreateDefaultSubagentsOptions = {},
  clarificationOptions: Partial<ClarificationConfig> = {},
  promptLoader: PromptLoader = DEFAULT_PROMPT_LOADER,
): SubAgent[] {
  const sharedInterrupts = createDefaultInterrupts();
  const clarification = createClarificationConfig(clarificationOptions);

  const clarifier = mergeSubagent(
    {
      name: "clarifier",
      description:
        "Gate new requests, ask only the missing high-value questions, and return structured readiness decisions.",
      systemPrompt: promptLoader.getClarifierPrompt(clarification),
      responseFormat: clarificationResultSchema,
      interruptOn: sharedInterrupts,
      tools: [],
      skills: [CLARIFY_DEEPLY_SKILL_DIR],
    },
    options.clarifier,
  );

  const researcher = mergeSubagent(
    {
      name: "researcher",
      description: "Gather evidence, collect source-backed notes, and isolate research context.",
      systemPrompt: promptLoader.getResearcherPrompt(),
      interruptOn: sharedInterrupts,
      tools: [],
      skills: [],
    },
    options.researcher,
  );

  const analyst = mergeSubagent(
    {
      name: "analyst",
      description:
        "Turn findings into structured tradeoffs, plans, and implementation-ready analysis.",
      systemPrompt: promptLoader.getAnalystPrompt(),
      interruptOn: sharedInterrupts,
      tools: [],
      skills: [],
    },
    options.analyst,
  );

  const critic = mergeSubagent(
    {
      name: "critic",
      description:
        "Challenge weak reasoning, missing evidence, and risky actions before final output.",
      systemPrompt: promptLoader.getCriticPrompt(),
      interruptOn: sharedInterrupts,
      tools: [],
      skills: [],
    },
    options.critic,
  );

  return [clarifier, researcher, analyst, critic];
}
