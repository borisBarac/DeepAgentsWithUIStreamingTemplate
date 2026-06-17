export const DEFAULT_SCRATCH_ROOT = "/scratch";
export const DEFAULT_PLANS_ROOT = "/plans";
export const DEFAULT_REPORTS_ROOT = "/reports";
export const DEFAULT_ARTIFACTS_ROOT = "/artifacts";
export const DEFAULT_MEMORY_ROOT = "/memory";
export const DEFAULT_SKILLS_ROOT = "/skills";

export const DEFAULT_PROJECT_FACTS_PATH = `${DEFAULT_MEMORY_ROOT}/project-facts.md`;
export const DEFAULT_USER_PREFERENCES_PATH = `${DEFAULT_MEMORY_ROOT}/user-preferences.md`;

export const DEFAULT_MEMORY_FILE_PATHS = [
  DEFAULT_PROJECT_FACTS_PATH,
  DEFAULT_USER_PREFERENCES_PATH,
] as const;
