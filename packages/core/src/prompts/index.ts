import analystPromptText from "../../prompts/analyst.md" with { type: "text" };
import baselinePromptText from "../../prompts/baseline.md" with { type: "text" };
import clarifierPromptText from "../../prompts/clarifier.md" with { type: "text" };
import criticPromptText from "../../prompts/critic.md" with { type: "text" };
import researcherPromptText from "../../prompts/researcher.md" with { type: "text" };
import reviewAgentPromptText from "../../prompts/review-agent.md" with { type: "text" };
import supervisorPromptText from "../../prompts/supervisor.md" with { type: "text" };
import {
  type ClarificationConfig,
  createClarificationConfig,
  DEFAULT_CLARIFICATION_MAX_ROUNDS,
  DEFAULT_CLARIFICATION_QUESTIONS_PER_ROUND,
} from "../clarification/index.ts";

export interface PromptLoader {
  getBaselinePrompt(): string;
  getSupervisorPrompt(config: Partial<ClarificationConfig>): string;
  getClarifierPrompt(config: Partial<ClarificationConfig>): string;
  getResearcherPrompt(): string;
  getAnalystPrompt(): string;
  getCriticPrompt(): string;
  getReviewAgentPrompt(): string;
}

function renderPromptTemplate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (rendered, [key, value]) => rendered.replaceAll(`{{${key}}}`, String(value)),
    template,
  );
}

export class MarkdownPromptLoader implements PromptLoader {
  getBaselinePrompt(): string {
    return baselinePromptText;
  }

  getSupervisorPrompt(config: Partial<ClarificationConfig> = {}): string {
    const clarification = createClarificationConfig(config);

    return renderPromptTemplate(supervisorPromptText, {
      maxRounds: clarification.maxRounds,
    });
  }

  getClarifierPrompt(config: Partial<ClarificationConfig> = {}): string {
    const clarification = createClarificationConfig(config);

    return renderPromptTemplate(clarifierPromptText, {
      maxRounds: clarification.maxRounds,
      questionsPerRound: clarification.questionsPerRound,
    });
  }

  getResearcherPrompt(): string {
    return researcherPromptText;
  }

  getAnalystPrompt(): string {
    return analystPromptText;
  }

  getCriticPrompt(): string {
    return criticPromptText;
  }

  getReviewAgentPrompt(): string {
    return reviewAgentPromptText;
  }
}

export const DEFAULT_PROMPT_LOADER = new MarkdownPromptLoader();

export const DEFAULT_BASELINE_SYSTEM_PROMPT = DEFAULT_PROMPT_LOADER.getBaselinePrompt();

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

export const DEFAULT_CRITIC_SYSTEM_PROMPT = DEFAULT_PROMPT_LOADER.getCriticPrompt();

export const DEFAULT_REVIEW_AGENT_SYSTEM_PROMPT = DEFAULT_PROMPT_LOADER.getReviewAgentPrompt();

export const DEFAULT_CLARIFIER_SYSTEM_PROMPT = createClarifierSystemPrompt({
  maxRounds: DEFAULT_CLARIFICATION_MAX_ROUNDS,
  questionsPerRound: DEFAULT_CLARIFICATION_QUESTIONS_PER_ROUND,
});

export const DEFAULT_SYSTEM_PROMPT = DEFAULT_SUPERVISOR_SYSTEM_PROMPT;
