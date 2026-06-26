import type { CreateDeepAgentParams } from "deepagents";

import type { StructuredOutputMethod } from "../models/types.ts";
import type { GuardrailPolicyLoader, TaskScopePolicyBundle } from "./policies.ts";

export type DeepAgentMiddleware = NonNullable<CreateDeepAgentParams["middleware"]>[number];

export type SafetyClassifier = {
  invoke(input: unknown): Promise<unknown>;
};

export type StructuredSafetyModel = {
  withStructuredOutput(
    schema: unknown,
    options?: { method?: StructuredOutputMethod },
  ): SafetyClassifier;
};

export type TaskScopeClassifier = {
  invoke(input: unknown): Promise<unknown>;
};

export type StructuredTaskScopeModel = {
  withStructuredOutput(
    schema: unknown,
    options?: { method?: StructuredOutputMethod },
  ): TaskScopeClassifier;
};

export type GuardrailSafetyOptions = {
  classifier?: SafetyClassifier;
  model?: StructuredSafetyModel;
  refusalMessage?: string;
};

export type GuardrailTaskScopeOptions = {
  classifier?: TaskScopeClassifier;
  model?: StructuredTaskScopeModel;
  policies?: Partial<TaskScopePolicyBundle>;
  refusalMessage?: string;
};

export type CreateGuardrailDecisionOptions = {
  enabled?: boolean;
  middleware?: CreateDeepAgentParams["middleware"];
  policyLoader?: GuardrailPolicyLoader;
  safety?: false | GuardrailSafetyOptions;
  safetyModel?: StructuredSafetyModel;
  taskScopeModel?: StructuredTaskScopeModel;
  taskScope?: false | GuardrailTaskScopeOptions;
};

export type GuardrailDecisionRuntime = {
  enabled: {
    safety: boolean;
    taskScope: boolean;
  };
  middleware: DeepAgentMiddleware[];
  policies: TaskScopePolicyBundle;
};
