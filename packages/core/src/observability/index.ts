export type LangSmithTracingOptions = {
  enabled?: boolean;
  projectName?: string;
  apiKey?: string;
  endpoint?: string;
};

export type LangSmithTracingConfig = {
  enabled: boolean;
  projectName?: string;
  endpoint?: string;
};

const trueValue = "true";

function setEnvIfValue(key: string, value: string | undefined): void {
  if (value) {
    process.env[key] = value;
  }
}

export function configureLangSmithTracing(
  options: LangSmithTracingOptions = {},
): LangSmithTracingConfig {
  setEnvIfValue("LANGSMITH_API_KEY", options.apiKey);
  setEnvIfValue("LANGSMITH_PROJECT", options.projectName);
  setEnvIfValue("LANGSMITH_ENDPOINT", options.endpoint);

  const hasLangSmithApiKey = Boolean(process.env.LANGSMITH_API_KEY);
  const enabled = options.enabled ?? hasLangSmithApiKey;

  if (enabled) {
    process.env.LANGSMITH_TRACING = trueValue;
  }

  return {
    enabled,
    projectName: process.env.LANGSMITH_PROJECT,
    endpoint: process.env.LANGSMITH_ENDPOINT,
  };
}
