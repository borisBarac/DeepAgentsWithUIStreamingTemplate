import { DEFAULT_GUARDRAIL_POLICY_LOADER, type TaskScopePolicyBundle } from "./policies.ts";
import { createSafetyGuardrail } from "./safety.ts";
import { createTaskScopeGuardrail } from "./task-scope.ts";
import type {
  CreateGuardrailDecisionOptions,
  DeepAgentMiddleware,
  GuardrailDecisionRuntime,
} from "./types.ts";

export function createGuardrailDecision(
  options: CreateGuardrailDecisionOptions = {},
): GuardrailDecisionRuntime {
  const policyLoader = options.policyLoader ?? DEFAULT_GUARDRAIL_POLICY_LOADER;
  const taskScopeOptions = options.taskScope === false ? undefined : options.taskScope;
  const policies: TaskScopePolicyBundle = {
    requiredContext:
      taskScopeOptions?.policies?.requiredContext ?? policyLoader.getRequiredContextPolicy(),
    allowedTasks: taskScopeOptions?.policies?.allowedTasks ?? policyLoader.getAllowedTasksPolicy(),
    disallowedTasks:
      taskScopeOptions?.policies?.disallowedTasks ?? policyLoader.getDisallowedTasksPolicy(),
  };

  if (options.enabled === false) {
    return {
      enabled: {
        safety: false,
        taskScope: false,
      },
      middleware: [...(options.middleware ?? [])],
      policies,
    };
  }

  const guardrails: DeepAgentMiddleware[] = [];
  const safetyEnabled = options.safety !== false;
  // Nested model options are rail-specific overrides; top-level models are convenience defaults.
  const taskScopeModel = taskScopeOptions?.model ?? options.taskScopeModel;

  if (options.safety !== false) {
    const safetyOptions = options.safety ?? {};
    const safetyModel = safetyOptions.model ?? options.safetyModel ?? taskScopeModel;
    guardrails.push(
      createSafetyGuardrail({
        classifier: safetyOptions.classifier,
        model: safetyModel,
        refusalMessage: safetyOptions.refusalMessage,
      }),
    );
  }

  const taskScopeClassifier = taskScopeOptions?.classifier;
  const taskScopeEnabled =
    options.taskScope !== false && Boolean(taskScopeClassifier || taskScopeModel);

  if (taskScopeEnabled) {
    guardrails.push(
      createTaskScopeGuardrail({
        ...taskScopeOptions,
        model: taskScopeModel,
        policies,
      }),
    );
  }

  return {
    enabled: {
      safety: safetyEnabled,
      taskScope: taskScopeEnabled,
    },
    middleware: [...guardrails, ...(options.middleware ?? [])],
    policies,
  };
}
