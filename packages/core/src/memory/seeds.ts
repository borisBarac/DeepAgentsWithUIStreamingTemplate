import {
  DEFAULT_PROJECT_FACTS_PATH,
  DEFAULT_USER_PREFERENCES_PATH,
} from "../scaffold/constants.ts";

export const DEFAULT_PROJECT_FACTS_SEED = `# Project Facts

Stable facts about this project and environment that should persist across runs.

## What belongs here

- Stable project and environment facts: language, framework, build commands, and conventions.
- Durable repo context that future runs can reuse without rediscovering.

## What does not belong here

- Inferred preferences. Only record what was explicitly stated by the user.
- Credentials or other sensitive material.
- Transient task details, scratch notes, or per-conversation state.

## Facts

<!-- Record concise, stable facts here as they are confirmed. -->
`;

export const DEFAULT_USER_PREFERENCES_SEED = `# User Preferences

Explicit preferences the user has asked the agent to remember.

## What belongs here

- Preferences the user stated in their own words.

## What does not belong here

- Inferred or guessed preferences.
- Credentials or other sensitive material.
- Instructions that only apply to a single task.

## Preferences

<!-- Record only explicit preferences the user asks to remember. -->
`;

export type MemorySeedFile = {
  path: string;
  content: string;
};

export function createDefaultMemorySeedFiles(): MemorySeedFile[] {
  return [
    { path: DEFAULT_PROJECT_FACTS_PATH, content: DEFAULT_PROJECT_FACTS_SEED },
    { path: DEFAULT_USER_PREFERENCES_PATH, content: DEFAULT_USER_PREFERENCES_SEED },
  ];
}

export function createMemorySeedFiles(
  overrides: Partial<Record<"projectFacts" | "userPreferences", string>> = {},
): MemorySeedFile[] {
  return [
    {
      path: DEFAULT_PROJECT_FACTS_PATH,
      content: overrides.projectFacts ?? DEFAULT_PROJECT_FACTS_SEED,
    },
    {
      path: DEFAULT_USER_PREFERENCES_PATH,
      content: overrides.userPreferences ?? DEFAULT_USER_PREFERENCES_SEED,
    },
  ];
}
