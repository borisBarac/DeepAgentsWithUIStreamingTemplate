import { HumanMessage } from "@langchain/core/messages";
import type { SubAgent } from "deepagents";
import { type AgentMiddleware, providerStrategy, StructuredOutputParsingError } from "langchain";
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
import type { CreateDefaultSubagentCatalogOptions, DefaultSubagentCatalog } from "./types.ts";

const STRUCTURED_JSON_PROMPT = "Respond with a single JSON object matching the requested schema.";
const STRUCTURED_JSON_CORRECTION =
  "Your previous response was not valid JSON matching the requested schema. Return one corrected JSON object only. Required JSON Schema:";
const STRUCTURED_JSON_MIDDLEWARE_NAME = "ScaffoldStructuredJsonObject";

function hasStructuredOutputParsingCause(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current != null && !seen.has(current)) {
    if (current instanceof StructuredOutputParsingError) return true;
    seen.add(current);
    if (typeof current !== "object" || !("cause" in current)) return false;
    current = current.cause;
  }
  return false;
}

function createStructuredJsonMiddleware(schema: unknown): AgentMiddleware {
  return {
    name: STRUCTURED_JSON_MIDDLEWARE_NAME,
    wrapModelCall: async (request, handler) => {
      const enforcedRequest = {
        ...request,
        modelSettings: {
          ...request.modelSettings,
          response_format: { type: "json_object" },
          outputConfig: undefined,
          responseSchema: undefined,
          ls_structured_output_format: undefined,
          strict: undefined,
        },
      };

      try {
        return await handler(enforcedRequest);
      } catch (error) {
        if (!hasStructuredOutputParsingCause(error)) {
          throw error;
        }

        return handler({
          ...enforcedRequest,
          messages: [
            ...request.messages,
            new HumanMessage(`${STRUCTURED_JSON_CORRECTION}\n${JSON.stringify(schema)}`),
          ],
        });
      }
    },
  };
}

/**
 * Required for OpenAI-compatible providers that use `response_format:
 * json_object`: DeepSeek rejects requests whose prompt does not mention "json"
 * (`400 Prompt must contain the word 'json'`).
 */
function withStructuredJsonPrompt(prompt: string): string {
  return `${prompt}\n\n${STRUCTURED_JSON_PROMPT}`;
}

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
    middleware: [createStructuredJsonMiddleware(responseFormat.schema)],
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
        "Gate new requests, ask only the missing high-value questions, and return structured readiness decisions.",
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
          "Turn clarified product requests into a batch of structured product cards (title, description, image) for the streaming interaction zone.",
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
