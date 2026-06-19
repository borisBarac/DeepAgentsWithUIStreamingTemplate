export type LangSmithTracingOptions = {
  enabled?: boolean;
  projectName?: string;
  apiKey?: string;
  endpoint?: string;
  workspaceId?: string;
};

export type LangSmithTracingConfig = {
  enabled: boolean;
  projectName?: string;
  endpoint?: string;
  workspaceId?: string;
};

const trueValue = "true";
const falseValue = "false";

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value?.toLowerCase() === trueValue) return true;
  if (value?.toLowerCase() === falseValue) return false;
  return undefined;
}

function setEnvIfValue(key: string, value: string | undefined): void {
  if (value !== undefined) {
    process.env[key] = value;
  }
}

export function configureLangSmithTracing(
  options: LangSmithTracingOptions = {},
): LangSmithTracingConfig {
  setEnvIfValue("LANGSMITH_API_KEY", options.apiKey);
  setEnvIfValue("LANGSMITH_PROJECT", options.projectName);
  setEnvIfValue("LANGSMITH_ENDPOINT", options.endpoint);
  setEnvIfValue("LANGSMITH_WORKSPACE_ID", options.workspaceId);

  const hasLangSmithApiKey = Boolean(process.env.LANGSMITH_API_KEY);
  const enabled =
    options.enabled ?? parseBooleanEnv(process.env.LANGSMITH_TRACING) ?? hasLangSmithApiKey;

  process.env.LANGSMITH_TRACING = enabled ? trueValue : falseValue;

  return {
    enabled,
    projectName: process.env.LANGSMITH_PROJECT,
    endpoint: process.env.LANGSMITH_ENDPOINT,
    workspaceId: process.env.LANGSMITH_WORKSPACE_ID,
  };
}
