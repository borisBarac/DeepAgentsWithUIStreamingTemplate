import type { SubAgent } from "deepagents";
import { providerStrategy } from "langchain";
import type { ZodType } from "zod";

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
import { createStructuredJsonMiddleware, withStructuredJsonPrompt } from "./structured-json.ts";
import type { CreateDefaultSubagentCatalogOptions, DefaultSubagentCatalog } from "./types.ts";

function mergeSubagent(base: SubAgent, override: Partial<SubAgent> | undefined): SubAgent {
  if (!override) {
    return base;
  }

  const hasResponseFormatOverride = override.responseFormat !== undefined;

  return {
    ...base,
    ...override,
    tools: override.tools ?? base.tools,
    model: override.model ?? base.model,
    middleware: hasResponseFormatOverride
      ? override.middleware
      : [...(override.middleware ?? []), ...(base.middleware ?? [])],
    interruptOn: override.interruptOn ?? base.interruptOn,
    skills: override.skills ?? base.skills,
    responseFormat: hasResponseFormatOverride ? override.responseFormat : base.responseFormat,
    permissions: override.permissions ?? base.permissions,
  };
}

function structuredSubagent<TSchema extends ZodType>(
  subagent: Omit<SubAgent, "middleware" | "responseFormat"> & {
    responseFormat: TSchema;
  },
): SubAgent {
  const responseFormat = providerStrategy(subagent.responseFormat);
  return {
    ...subagent,
    responseFormat,
    middleware: [
      createStructuredJsonMiddleware(responseFormat.schema, { retryOnParsingError: true }),
    ],
  };
}

export function createDefaultSubagentCatalog(
  options: CreateDefaultSubagentCatalogOptions = {},
  clarificationOptions: Partial<ClarificationConfig> = {},
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
    structuredSubagent({
      name: "clarifier",
      description:
        "Advance requests to execution readiness with bounded high-value questions and explicit assumptions at the cap.",
      systemPrompt: withStructuredJsonPrompt(promptLoader.getClarifierPrompt(clarification)),
      responseFormat: clarificationResultSchema,
      model: options.modelRuntime?.getModelForRole("clarifier"),
      tools: [],
      skills: [CLARIFY_DEEPLY_SKILL_DIR],
    }),
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
    structuredSubagent({
      name: DEFAULT_REVIEW_AGENT_NAME,
      description: DEFAULT_REVIEW_AGENT_DESCRIPTION,
      systemPrompt: withStructuredJsonPrompt(promptLoader.getReviewAgentPrompt()),
      responseFormat: reviewReportSchema,
      model: options.modelRuntime?.getModelForRole("reviewer"),
      tools: [],
      skills: [],
    }),
    options.reviewer,
  );

  let imageDesigner: SubAgent | undefined;
  let productGenerator: SubAgent | undefined;
  const subagents: SubAgent[] = [clarifier, researcher, analyst];

  if (imageDesignerTool) {
    imageDesigner = mergeSubagent(
      structuredSubagent({
        name: "image-designer",
        description:
          "Turn image requests into production-ready prompts, generate or edit exactly once, and return the prompt plus final image result.",
        systemPrompt: withStructuredJsonPrompt(promptLoader.getImageDesignerPrompt()),
        responseFormat: imageDesignerResponseSchema,
        model: options.modelRuntime?.getModelForRole("image-designer"),
        tools: [imageDesignerTool],
        skills: [],
      }),
      options.imageDesigner,
    );
    subagents.push(imageDesigner);
  }

  if (options.generativeUi) {
    productGenerator = mergeSubagent(
      structuredSubagent({
        name: "product-generator",
        description:
          "Generate or revise the complete enabled product-card batch from the completed outcome and review feedback.",
        systemPrompt: withStructuredJsonPrompt(promptLoader.getProductGeneratorPrompt()),
        responseFormat: productCardBatchSchema,
        model: options.modelRuntime?.getModelForRole("product-generator"),
        tools: imageDesignerTool ? [imageDesignerTool] : [],
        skills: [],
      }),
      options.productGenerator,
    );
    subagents.push(productGenerator);
  }

  subagents.push(reviewer);
  return {
    byRole: {
      clarifier,
      researcher,
      analyst,
      reviewer,
      "image-designer": imageDesigner,
      "product-generator": productGenerator,
    },
    all: subagents,
  };
}
