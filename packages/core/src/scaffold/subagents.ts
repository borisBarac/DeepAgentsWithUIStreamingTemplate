import type { SubAgent } from "deepagents";

import {
  type ClarificationConfig,
  clarificationResultSchema,
  createClarificationConfig,
} from "../clarification/index.ts";
import { productCardBatchSchema } from "../generative-ui/index.ts";
import { createImageDesignerTool, imageDesignerResponseSchema } from "../image-designer/index.ts";
import { DEFAULT_PROMPT_LOADER, type PromptLoader } from "../prompts/index.ts";
import {
  DEFAULT_REVIEW_AGENT_DESCRIPTION,
  DEFAULT_REVIEW_AGENT_NAME,
  reviewReportSchema,
} from "../review/index.ts";
import { createDockerSandboxBackend, createPythonSandboxTool } from "../sandbox/index.ts";
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

export function createDefaultSubagents(
  options: CreateDefaultSubagentsOptions = {},
  clarificationOptions: Partial<ClarificationConfig> = {},
  promptLoader: PromptLoader = DEFAULT_PROMPT_LOADER,
): SubAgent[] {
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
        "Gate new requests, ask only the missing high-value questions, and return structured readiness decisions.",
      systemPrompt: promptLoader.getClarifierPrompt(clarification),
      responseFormat: clarificationResultSchema,
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
      responseFormat: reviewReportSchema,
      model: options.modelRuntime?.getModelForRole("reviewer"),
      tools: [],
      skills: [],
    },
    options.reviewer,
  );

  const subagents: SubAgent[] = [clarifier, researcher, analyst];

  if (imageDesignerTool) {
    const imageDesigner = mergeSubagent(
      {
        name: "image-designer",
        description:
          "Turn image requests into production-ready prompts, generate or edit exactly once, and return the prompt plus final image result.",
        systemPrompt: promptLoader.getImageDesignerPrompt(),
        responseFormat: imageDesignerResponseSchema,
        model: options.modelRuntime?.getModelForRole("image-designer"),
        tools: [imageDesignerTool],
        skills: [],
      },
      options.imageDesigner,
    );
    subagents.push(imageDesigner);
  }

  if (options.generativeUi) {
    const productGenerator = mergeSubagent(
      {
        name: "product-generator",
        description:
          "Turn clarified product requests into a batch of structured product cards (title, description, image) for the streaming interaction zone.",
        systemPrompt: promptLoader.getProductGeneratorPrompt(),
        responseFormat: productCardBatchSchema,
        model: options.modelRuntime?.getModelForRole("product-generator"),
        tools: imageDesignerTool ? [imageDesignerTool] : [],
        skills: [],
      },
      options.productGenerator,
    );
    subagents.push(productGenerator);
  }

  subagents.push(reviewer);
  return subagents;
}
