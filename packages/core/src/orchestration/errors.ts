import type {
  OrchestratedDeepAgentError,
  OrchestratedDeepAgentErrorCategory,
  OrchestratedDeepAgentRole,
} from "./types.ts";

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error ?? "");
}

function categorizeError(error: unknown): OrchestratedDeepAgentErrorCategory {
  const message = errorToMessage(error);
  if (/permission|denied|forbidden|unauthor/i.test(message)) return "permission";
  if (/abort|cancel|host|signal/i.test(message)) return "host";
  if (/valid|schema|parse|expected|type error/i.test(message)) return "validation";
  if (/tool|timeout|network|fetch|connection|econn/i.test(message)) return "tool";
  if (/model|rate|quota|api key|429|500|503|overloaded/i.test(message)) return "model";
  return "unknown";
}

export function toStructuredError(
  error: unknown,
  node: string,
  options: { required?: boolean; retryCount?: number } = {},
): OrchestratedDeepAgentError {
  return {
    node,
    category: categorizeError(error),
    message: errorToMessage(error),
    retryCount: options.retryCount ?? 0,
    required: options.required ?? false,
  };
}

export function missingAgentError(
  role: OrchestratedDeepAgentRole,
  required: boolean,
): OrchestratedDeepAgentError {
  return {
    node: role,
    category: "validation",
    message: `No agent configured for the "${role}" stage and no model was provided to build a default.`,
    retryCount: 0,
    required,
  };
}
