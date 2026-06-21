import { createModelRuntime } from "../models/index.ts";
import type { ReviewReport } from "../review/index.ts";
import type {
  CreateOrchestratedDeepAgentGraphOptions,
  OrchestratedDeepAgent,
  OrchestratedDeepAgentInvokeInput,
  OrchestratedDeepAgentState,
} from "./index.ts";

export function createMockAgent(response: string): {
  agent: OrchestratedDeepAgent;
  calls: OrchestratedDeepAgentInvokeInput[];
} {
  const calls: OrchestratedDeepAgentInvokeInput[] = [];
  const agent: OrchestratedDeepAgent = {
    invoke: async (input) => {
      calls.push(input);
      return {
        messages: [...input.messages, { role: "assistant", content: response }],
      };
    },
  };
  return { agent, calls };
}

export function createFailingAgent(error: unknown): {
  agent: OrchestratedDeepAgent;
  calls: OrchestratedDeepAgentInvokeInput[];
} {
  const calls: OrchestratedDeepAgentInvokeInput[] = [];
  const agent: OrchestratedDeepAgent = {
    invoke: async (input) => {
      calls.push(input);
      throw error;
    },
  };
  return { agent, calls };
}

export const APPROVED_REVIEW: ReviewReport = {
  status: "approved",
  score: 91,
  criticalIssues: [],
  majorIssues: [],
  minorIssues: [],
  requiredChanges: [],
  finalRecommendation: "ready to deliver",
};

export const CHANGES_REQUIRED_REVIEW: ReviewReport = {
  status: "changes_required",
  score: 58,
  criticalIssues: [{ issue: "no tests", impact: "correctness", evidence: "none present" }],
  majorIssues: [],
  minorIssues: [],
  requiredChanges: ["add tests for the consumer"],
  finalRecommendation: "address required changes before delivery",
};

export const BLOCKED_REVIEW: ReviewReport = {
  status: "blocked",
  score: 20,
  criticalIssues: [],
  majorIssues: [],
  minorIssues: [],
  requiredChanges: [],
  finalRecommendation: "missing decision-critical context",
};

export function createReviewAgent(reports: ReviewReport | ReviewReport[]): {
  agent: OrchestratedDeepAgent;
  calls: OrchestratedDeepAgentInvokeInput[];
} {
  const queue = Array.isArray(reports) ? [...reports] : [reports];
  const calls: OrchestratedDeepAgentInvokeInput[] = [];
  const agent: OrchestratedDeepAgent = {
    invoke: async (input) => {
      calls.push(input);
      const report = queue.shift() ?? APPROVED_REVIEW;
      return {
        messages: [...input.messages, { role: "assistant", content: JSON.stringify(report) }],
      };
    },
  };
  return { agent, calls };
}

export function noClarificationOptions(): CreateOrchestratedDeepAgentGraphOptions {
  return {
    clarification: { enabled: false },
    modelRuntime: runtimeWithoutRoleAssignments(),
  };
}

export function invokeInput(
  task: string,
  overrides: Partial<OrchestratedDeepAgentState> = {},
): OrchestratedDeepAgentState {
  return {
    task,
    messages: [],
    next: "final",
    errors: [],
    ...overrides,
  };
}

export function runtimeWithoutRoleAssignments() {
  return createModelRuntime({
    connections: {
      openrouter: { provider: "openrouter", apiKey: "test-key" },
    },
    models: {
      unused: { connection: "openrouter", model: "unused-model" },
    },
    assignments: {},
  });
}
