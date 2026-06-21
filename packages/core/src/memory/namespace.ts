import { Buffer } from "node:buffer";
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
export const USER_MEMORY_NAMESPACE_ROOT = "users";
export const USER_MEMORY_NAMESPACE_SUFFIX = "memory";

const SAFE_USER_ID_PATTERN = /^[-A-Za-z0-9._@+:~]+$/;
const RAW_USER_ID_NAMESPACE_PATTERN = /^[-A-Za-z0-9_]+$/;
const ENCODED_USER_ID_PREFIX = "encoded_";

export type SingleUserMemoryNamespace = string[];

export function createSingleUserMemoryNamespace(): SingleUserMemoryNamespace {
  return [...DEFAULT_SINGLE_USER_MEMORY_NAMESPACE];
}

export type UserMemoryNamespace = string[];

export function createUserMemoryNamespace(userId?: string): UserMemoryNamespace {
  if (userId === undefined || userId === null || userId === "") {
    return createSingleUserMemoryNamespace();
  }

  if (!SAFE_USER_ID_PATTERN.test(userId)) {
    throw new Error(
      "userId may only contain letters, numbers, '-', '_', '.', '@', '+', ':', and '~'.",
    );
  }

  return [
    USER_MEMORY_NAMESPACE_ROOT,
    createUserMemoryNamespaceSegment(userId),
    USER_MEMORY_NAMESPACE_SUFFIX,
  ];
}

function createUserMemoryNamespaceSegment(userId: string): string {
  if (RAW_USER_ID_NAMESPACE_PATTERN.test(userId) && !userId.startsWith(ENCODED_USER_ID_PREFIX)) {
    return userId;
  }

  return `${ENCODED_USER_ID_PREFIX}${Buffer.from(userId, "utf8").toString("base64url")}`;
}

export type MemoryNamespaceInput = SingleUserMemoryNamespace | StoreBackendNamespaceFactory;

export function resolveMemoryNamespace(namespace?: MemoryNamespaceInput): MemoryNamespaceInput {
  return namespace ?? createSingleUserMemoryNamespace();
}
