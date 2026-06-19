import {
  classifyTaskScopeRequest,
  resolveTaskScopePolicies,
  type TaskScopeDecision,
  taskScopeDecisionSchema,
} from "./task-scope.ts";
import type { TaskScopeClassifier, TaskScopeGatekeeperOptions } from "./types.ts";

export const DEFAULT_GATEKEEPER_BLOCKED_MESSAGE =
  "This request is outside the system parameters, so it was not passed to the main agent.";

export type TaskScopeGatekeeperResult = {
  decision: TaskScopeDecision;
  blockedMessage?: string;
};

export type TaskScopeGatekeeper = {
  check(task: string): Promise<TaskScopeGatekeeperResult>;
};

function createBlockedMessage(reason: string, prefix: string): string {
  const normalizedReason = reason.trim();
  return normalizedReason ? `${prefix} ${normalizedReason}` : prefix;
}

export function createTaskScopeGatekeeper(
  options: TaskScopeGatekeeperOptions = {},
): TaskScopeGatekeeper {
  const classifier: TaskScopeClassifier | undefined =
    options.classifier ??
    options.model?.withStructuredOutput(taskScopeDecisionSchema, {
      name: "task_scope_gatekeeper_decision",
    });

  if (!classifier) {
    throw new Error("Task scope gatekeeper requires a classifier or structured-output model.");
  }

  const policies = resolveTaskScopePolicies(options.policies);
  const blockedMessage = options.blockedMessage ?? DEFAULT_GATEKEEPER_BLOCKED_MESSAGE;

  return {
    async check(task) {
      const decision = await classifyTaskScopeRequest(task, classifier, policies);
      return decision.inScope
        ? { decision }
        : {
            decision,
            blockedMessage: createBlockedMessage(decision.reason, blockedMessage),
          };
    },
  };
}
