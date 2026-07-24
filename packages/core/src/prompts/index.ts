import analystPromptText from "../../prompts/analyst.md" with { type: "text" };
import casualScopeClassificationPromptText from "../../prompts/casual-scope-classification.md" with {
  type: "text",
};
import clarifierPromptText from "../../prompts/clarifier.md" with { type: "text" };
import currentPromptText from "../../prompts/current.md" with { type: "text" };
import filesystemContractPromptText from "../../prompts/filesystem-contract.md" with {
  type: "text",
};
import generalPurposePromptText from "../../prompts/general-purpose.md" with { type: "text" };
import generativeUiJsonObjectPromptText from "../../prompts/generative-ui-json-object.md" with {
  type: "text",
};
import imageDesignerPromptText from "../../prompts/image-designer.md" with { type: "text" };
import jsonRenderCatalogPromptText from "../../prompts/json-render-catalog.md" with {
  type: "text",
};
import productGeneratorPromptText from "../../prompts/product-generator.md" with { type: "text" };
import researcherPromptText from "../../prompts/researcher.md" with { type: "text" };
import reviewAgentPromptText from "../../prompts/review-agent.md" with { type: "text" };
import soulPromptText from "../../prompts/SOUL.md" with { type: "text" };
import safetyClassificationPromptText from "../../prompts/safety-classification.md" with {
  type: "text",
};
import structuredJsonPromptText from "../../prompts/structured-json.md" with { type: "text" };
import structuredJsonCorrectionPromptText from "../../prompts/structured-json-correction.md" with {
  type: "text",
};
import supervisorPromptText from "../../prompts/supervisor.md" with { type: "text" };
import taskScopeClassificationPromptText from "../../prompts/task-scope-classification.md" with {
  type: "text",
};
import uiRepairFeedbackPromptText from "../../prompts/ui-repair-feedback.md" with { type: "text" };
import {
  type ClarificationOverrideOptions,
  createClarificationConfig,
  DEFAULT_CLARIFICATION_QUESTIONS_PER_ROUND,
} from "../clarification/index.ts";

export interface PromptLoader {
  getSupervisorPrompt(config: ClarificationOverrideOptions): string;
  getClarifierPrompt(config: ClarificationOverrideOptions): string;
  getResearcherPrompt(): string;
  getAnalystPrompt(): string;
  getImageDesignerPrompt(): string;
  getReviewAgentPrompt(): string;
  getProductGeneratorPrompt(): string;
}

export const FILESYSTEM_CONTRACT_PROMPT = filesystemContractPromptText.trim();
export const SOUL_PROMPT = soulPromptText.trim();

export function createCurrentContextPrompt(now = new Date()): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const currentDateTime = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: timezone,
  }).format(now);

  return renderPromptTemplate(currentPromptText, {
    currentDateTime: `${currentDateTime}; ${now.toISOString()}`,
    timezone,
  }).trim();
}

export function withFilesystemContract(prompt: string): string {
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.includes(FILESYSTEM_CONTRACT_PROMPT)) {
    return trimmedPrompt;
  }
  return `${trimmedPrompt}\n\n${FILESYSTEM_CONTRACT_PROMPT}`;
}

export function renderPromptTemplate(
  template: string,
  values: Record<string, string | number> = {},
): string {
  return Object.entries(values).reduce(
    (rendered, [key, value]) => rendered.replaceAll(`{{${key}}}`, String(value)),
    template,
  );
}

function definePromptTemplates<const T extends Readonly<Record<string, string>>>(
  templates: T,
): T & Readonly<Record<string, string>> {
  return templates;
}

export const CORE_PROMPT_TEMPLATES = definePromptTemplates({
  casualScopeClassification: casualScopeClassificationPromptText,
  generativeUiJsonObject: generativeUiJsonObjectPromptText,
  jsonRenderCatalog: jsonRenderCatalogPromptText,
  safetyClassification: safetyClassificationPromptText,
  structuredJson: structuredJsonPromptText,
  structuredJsonCorrection: structuredJsonCorrectionPromptText,
  taskScopeClassification: taskScopeClassificationPromptText,
  uiRepairFeedback: uiRepairFeedbackPromptText,
});

export class MarkdownPromptLoader implements PromptLoader {
  getSupervisorPrompt(config: ClarificationOverrideOptions = {}): string {
    const clarification = createClarificationConfig(config);

    return withFilesystemContract(
      `${SOUL_PROMPT}\n\n${renderPromptTemplate(supervisorPromptText, {
        maxRounds: clarification.maxRounds,
      })}`,
    );
  }

  getClarifierPrompt(config: ClarificationOverrideOptions = {}): string {
    const clarification = createClarificationConfig(config);

    return withFilesystemContract(
      renderPromptTemplate(clarifierPromptText, {
        maxRounds: clarification.maxRounds,
        questionsPerRound: clarification.questionsPerRound,
      }),
    );
  }

  getResearcherPrompt(): string {
    return withFilesystemContract(researcherPromptText);
  }

  getAnalystPrompt(): string {
    return withFilesystemContract(analystPromptText);
  }

  getImageDesignerPrompt(): string {
    return withFilesystemContract(imageDesignerPromptText);
  }

  getReviewAgentPrompt(): string {
    return withFilesystemContract(reviewAgentPromptText);
  }

  getProductGeneratorPrompt(): string {
    return withFilesystemContract(productGeneratorPromptText);
  }
}

export const DEFAULT_PROMPT_LOADER = new MarkdownPromptLoader();

export function createSupervisorSystemPrompt(
  clarificationOptions: ClarificationOverrideOptions = {},
): string {
  return DEFAULT_PROMPT_LOADER.getSupervisorPrompt(clarificationOptions);
}

export function createClarifierSystemPrompt(
  clarificationOptions: ClarificationOverrideOptions = {},
): string {
  return DEFAULT_PROMPT_LOADER.getClarifierPrompt(clarificationOptions);
}

export const DEFAULT_SUPERVISOR_SYSTEM_PROMPT = createSupervisorSystemPrompt({});

export const DEFAULT_RESEARCHER_SYSTEM_PROMPT = DEFAULT_PROMPT_LOADER.getResearcherPrompt();

export const DEFAULT_ANALYST_SYSTEM_PROMPT = DEFAULT_PROMPT_LOADER.getAnalystPrompt();

export const DEFAULT_IMAGE_DESIGNER_SYSTEM_PROMPT = DEFAULT_PROMPT_LOADER.getImageDesignerPrompt();

export const DEFAULT_REVIEW_AGENT_SYSTEM_PROMPT = DEFAULT_PROMPT_LOADER.getReviewAgentPrompt();
export const DEFAULT_PRODUCT_GENERATOR_SYSTEM_PROMPT =
  DEFAULT_PROMPT_LOADER.getProductGeneratorPrompt();

/**
 * System prompt for the auto-added `general-purpose` subagent. deepagents
 * injects this subagent into every agent unless explicitly disabled. The
 * repo's harness profile wires this prompt in via
 * `generalPurposeSubagent.systemPrompt` so the GP subagent follows the same
 * prose contract as the rest of the catalog.
 *
 * @see packages/core/src/profiles/index.ts
 */
export const DEFAULT_GENERAL_PURPOSE_SYSTEM_PROMPT =
  withFilesystemContract(generalPurposePromptText);

export const DEFAULT_CLARIFIER_SYSTEM_PROMPT = createClarifierSystemPrompt({
  questionsPerRound: DEFAULT_CLARIFICATION_QUESTIONS_PER_ROUND,
});
