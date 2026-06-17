import type { CreateDeepAgentParams } from "deepagents";
import type OpenAI from "openai";

import type { GuardrailPolicyLoader, TaskScopePolicyBundle } from "./policies.ts";

export type DeepAgentMiddleware = NonNullable<CreateDeepAgentParams["middleware"]>[number];

export type TaskScopeClassifier = {
  invoke(input: unknown): Promise<unknown>;
};

export type StructuredTaskScopeModel = {
  withStructuredOutput(schema: unknown, options?: { name?: string }): TaskScopeClassifier;
};

export type OpenAIContentSafetyClient = Pick<OpenAI, "moderations">;

export type GuardrailSafetyOptions = {
  model?: string;
  openai?: OpenAIContentSafetyClient;
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
