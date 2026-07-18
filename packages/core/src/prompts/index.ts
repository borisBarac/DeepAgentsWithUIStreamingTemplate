import analystPromptText from "../../prompts/analyst.md" with { type: "text" };
import clarificationTriagePromptText from "../../prompts/clarification-triage.md" with {
  type: "text",
};
import clarifierPromptText from "../../prompts/clarifier.md" with { type: "text" };
import generativeUiJsonObjectPromptText from "../../prompts/generative-ui-json-object.md" with {
  type: "text",
};
import imageDesignerPromptText from "../../prompts/image-designer.md" with { type: "text" };
import jsonRenderCatalogPromptText from "../../prompts/json-render-catalog.md" with {
  type: "text",
};
import presentationPromptText from "../../prompts/presentation.md" with { type: "text" };
import researcherPromptText from "../../prompts/researcher.md" with { type: "text" };
import reviewAgentPromptText from "../../prompts/review-agent.md" with { type: "text" };
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
  type ClarificationConfig,
  createClarificationConfig,
  DEFAULT_CLARIFICATION_MAX_ROUNDS,
  DEFAULT_CLARIFICATION_QUESTIONS_PER_ROUND,
} from "../clarification/index.ts";

export interface PromptLoader {
  getSupervisorPrompt(config: Partial<ClarificationConfig>): string;
  getClarifierPrompt(config: Partial<ClarificationConfig>): string;
  getClarificationTriagePrompt(): string;
  getResearcherPrompt(): string;
  getAnalystPrompt(): string;
  getImageDesignerPrompt(): string;
  getReviewAgentPrompt(): string;
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
  generativeUiJsonObject: generativeUiJsonObjectPromptText,
  jsonRenderCatalog: jsonRenderCatalogPromptText,
  presentation: presentationPromptText,
  safetyClassification: safetyClassificationPromptText,
  structuredJson: structuredJsonPromptText,
  structuredJsonCorrection: structuredJsonCorrectionPromptText,
  taskScopeClassification: taskScopeClassificationPromptText,
  uiRepairFeedback: uiRepairFeedbackPromptText,
  clarificationTriage: clarificationTriagePromptText,
});

function getCurrentDateTimeContext(): { currentDateTime: string; timezone: string } {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const humanReadable = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "shortOffset",
    timeZone: timezone,
  }).format(now);

  return {
    currentDateTime: `${humanReadable}; ${now.toISOString()}`,
    timezone,
  };
}

export class MarkdownPromptLoader implements PromptLoader {
  getSupervisorPrompt(config: Partial<ClarificationConfig> = {}): string {
    const clarification = createClarificationConfig(config);

    return renderPromptTemplate(supervisorPromptText, {
      maxRounds: clarification.maxRounds,
      ...getCurrentDateTimeContext(),
    });
  }

  getClarifierPrompt(config: Partial<ClarificationConfig> = {}): string {
    const clarification = createClarificationConfig(config);

    return renderPromptTemplate(clarifierPromptText, {
      maxRounds: clarification.maxRounds,
      questionsPerRound: clarification.questionsPerRound,
    });
  }

  getClarificationTriagePrompt(): string {
    return clarificationTriagePromptText;
  }

  getResearcherPrompt(): string {
    return researcherPromptText;
  }

  getAnalystPrompt(): string {
    return analystPromptText;
  }

  getImageDesignerPrompt(): string {
    return imageDesignerPromptText;
  }

  getReviewAgentPrompt(): string {
    return reviewAgentPromptText;
  }
}

export const DEFAULT_PROMPT_LOADER = new MarkdownPromptLoader();

export function createSupervisorSystemPrompt(
  clarificationOptions: Partial<ClarificationConfig> = {},
): string {
  return DEFAULT_PROMPT_LOADER.getSupervisorPrompt(clarificationOptions);
}

export function createClarifierSystemPrompt(
  clarificationOptions: Partial<ClarificationConfig> = {},
): string {
  return DEFAULT_PROMPT_LOADER.getClarifierPrompt(clarificationOptions);
}

export const DEFAULT_SUPERVISOR_SYSTEM_PROMPT = createSupervisorSystemPrompt({
  maxRounds: DEFAULT_CLARIFICATION_MAX_ROUNDS,
});

export const DEFAULT_RESEARCHER_SYSTEM_PROMPT = DEFAULT_PROMPT_LOADER.getResearcherPrompt();

export const DEFAULT_ANALYST_SYSTEM_PROMPT = DEFAULT_PROMPT_LOADER.getAnalystPrompt();

export const DEFAULT_IMAGE_DESIGNER_SYSTEM_PROMPT = DEFAULT_PROMPT_LOADER.getImageDesignerPrompt();

export const DEFAULT_REVIEW_AGENT_SYSTEM_PROMPT = DEFAULT_PROMPT_LOADER.getReviewAgentPrompt();

export const DEFAULT_CLARIFIER_SYSTEM_PROMPT = createClarifierSystemPrompt({
  maxRounds: DEFAULT_CLARIFICATION_MAX_ROUNDS,
  questionsPerRound: DEFAULT_CLARIFICATION_QUESTIONS_PER_ROUND,
});
