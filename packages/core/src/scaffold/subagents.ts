import type { SubAgent } from "deepagents";

import {
  type ClarificationOverrideOptions,
  createClarificationConfig,
} from "../clarification/index.ts";
import { createImageDesignerTool } from "../image-designer/index.ts";
import {
  DEFAULT_PROMPT_LOADER,
  type PromptLoader,
  withFilesystemContract,
} from "../prompts/index.ts";
import { DEFAULT_REVIEW_AGENT_DESCRIPTION, DEFAULT_REVIEW_AGENT_NAME } from "../review/index.ts";
import { createDockerSandboxBackend, createPythonSandboxTool } from "../sandbox/index.ts";
import { CLARIFY_DEEPLY_SKILL_DIR } from "../skills/index.ts";
import type { CreateDefaultSubagentCatalogOptions, DefaultSubagentCatalog } from "./types.ts";

function mergeSubagent(base: SubAgent, override: Partial<SubAgent> | undefined): SubAgent {
  if (!override) {
    return { ...base, systemPrompt: withFilesystemContract(base.systemPrompt) };
  }

  const merged = {
    ...base,
    ...override,
    tools: override.tools ?? base.tools,
    model: override.model ?? base.model,
    middleware: [...(override.middleware ?? []), ...(base.middleware ?? [])],
    interruptOn: override.interruptOn ?? base.interruptOn,
    skills: override.skills ?? base.skills,
    responseFormat: override.responseFormat ?? base.responseFormat,
    permissions: override.permissions ?? base.permissions,
  };
  return { ...merged, systemPrompt: withFilesystemContract(merged.systemPrompt) };
}

export function createDefaultSubagentCatalog(
  options: CreateDefaultSubagentCatalogOptions = {},
  clarificationOptions: ClarificationOverrideOptions = {},
  promptLoader: PromptLoader = DEFAULT_PROMPT_LOADER,
): DefaultSubagentCatalog {
  const clarification = createClarificationConfig(clarificationOptions);
  const imageDesignerTool = options.imageGenerationService
    ? createImageDesignerTool(options.imageGenerationService)
    : undefined;
  const pythonTool = createPythonSandboxTool({
    backend: options.pythonSandboxBackend ?? createDockerSandboxBackend(),
  });

  const clarifier = mergeSubagent(
    {
      name: "clarifier",
      description:
        "Advance requests to execution readiness with bounded high-value questions and explicit assumptions at the cap.",
      systemPrompt: promptLoader.getClarifierPrompt(clarification),
      model: options.modelRuntime?.getModelForRole("clarifier"),
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
      model: options.modelRuntime?.getModelForRole("researcher"),
      tools: [pythonTool, ...(options.additionalResearcherTools ?? [])],
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
      model: options.modelRuntime?.getModelForRole("analyst"),
      tools: [pythonTool],
      skills: [],
    },
    options.analyst,
  );

  const reviewer = mergeSubagent(
    {
      name: DEFAULT_REVIEW_AGENT_NAME,
      description: DEFAULT_REVIEW_AGENT_DESCRIPTION,
      systemPrompt: promptLoader.getReviewAgentPrompt(),
      model: options.modelRuntime?.getModelForRole("reviewer"),
      tools: [],
      skills: [],
    },
    options.reviewer,
  );

  let imageDesigner: SubAgent | undefined;
  const subagents: SubAgent[] = [clarifier, researcher, analyst];

  if (imageDesignerTool) {
    imageDesigner = mergeSubagent(
      {
        name: "image-designer",
        description:
          "Turn image requests into production-ready prompts, generate or edit exactly once, and return the prompt plus final image result.",
        systemPrompt: promptLoader.getImageDesignerPrompt(),
        model: options.modelRuntime?.getModelForRole("image-designer"),
        tools: [imageDesignerTool],
        skills: [],
      },
      options.imageDesigner,
    );
    subagents.push(imageDesigner);
  }

  subagents.push(reviewer);
  return {
    byRole: {
      clarifier,
      researcher,
      analyst,
      reviewer,
      "image-designer": imageDesigner,
    },
    all: subagents,
  };
}
