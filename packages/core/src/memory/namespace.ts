import type { StoreBackendNamespaceFactory } from "deepagents";

import {
  DEFAULT_MEMORY_FILE_PATHS,
  DEFAULT_MEMORY_ROOT,
  DEFAULT_PROJECT_FACTS_PATH,
  DEFAULT_USER_PREFERENCES_PATH,
} from "../scaffold/constants.ts";

export {
  DEFAULT_MEMORY_FILE_PATHS,
  DEFAULT_MEMORY_ROOT,
  DEFAULT_PROJECT_FACTS_PATH,
  DEFAULT_USER_PREFERENCES_PATH,
};

export const DEFAULT_SINGLE_USER_MEMORY_NAMESPACE = ["single-user"] as const;

export type SingleUserMemoryNamespace = string[];

export function createSingleUserMemoryNamespace(): SingleUserMemoryNamespace {
  return [...DEFAULT_SINGLE_USER_MEMORY_NAMESPACE];
}

export type MemoryNamespaceInput = SingleUserMemoryNamespace | StoreBackendNamespaceFactory;

export function resolveMemoryNamespace(namespace?: MemoryNamespaceInput): MemoryNamespaceInput {
  return namespace ?? createSingleUserMemoryNamespace();
}
