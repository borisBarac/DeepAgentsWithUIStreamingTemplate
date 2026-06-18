import allowedTasksText from "../../guardrails/taskScope.allowedTasks.md" with { type: "text" };
import disallowedTasksText from "../../guardrails/taskScope.disallowedTasks.md" with {
  type: "text",
};
import requiredContextText from "../../guardrails/taskScope.requiredContext.md" with {
  type: "text",
};

export type TaskScopePolicyBundle = {
  requiredContext: string;
  allowedTasks: string;
  disallowedTasks: string;
};

export interface GuardrailPolicyLoader {
  getRequiredContextPolicy(): string;
  getAllowedTasksPolicy(): string;
  getDisallowedTasksPolicy(): string;
}

export class MarkdownGuardrailPolicyLoader implements GuardrailPolicyLoader {
  getRequiredContextPolicy(): string {
    return requiredContextText;
  }

  getAllowedTasksPolicy(): string {
    return allowedTasksText;
  }

  getDisallowedTasksPolicy(): string {
    return disallowedTasksText;
  }
}

export const DEFAULT_GUARDRAIL_POLICY_LOADER = new MarkdownGuardrailPolicyLoader();
