import type { FilesystemPermission } from "deepagents";

import {
  DEFAULT_ARTIFACTS_ROOT,
  DEFAULT_MEMORY_ROOT,
  DEFAULT_PLANS_ROOT,
  DEFAULT_REPORTS_ROOT,
  DEFAULT_SCRATCH_ROOT,
  DEFAULT_SKILLS_ROOT,
} from "./constants.ts";
import type { CreateDefaultPermissionsOptions } from "./types.ts";

const DEFAULT_WRITABLE_ROOTS = [
  DEFAULT_SCRATCH_ROOT,
  DEFAULT_PLANS_ROOT,
  DEFAULT_REPORTS_ROOT,
  DEFAULT_ARTIFACTS_ROOT,
  DEFAULT_MEMORY_ROOT,
] as const;

const DEFAULT_READ_ONLY_ROOTS = [DEFAULT_SKILLS_ROOT] as const;

function expandDirectoryRoots(roots: readonly string[]): string[] {
  return roots.flatMap((root) => [root, `${root}/**`]);
}

export function createDefaultPermissions(
  options: CreateDefaultPermissionsOptions = {},
): FilesystemPermission[] {
  const readableRoots = [
    ...DEFAULT_WRITABLE_ROOTS,
    ...DEFAULT_READ_ONLY_ROOTS,
    ...(options.extraReadableRoots ?? []),
  ];
  const writableRoots = [...DEFAULT_WRITABLE_ROOTS, ...(options.extraWritableRoots ?? [])];

  const permissions: FilesystemPermission[] = [
    {
      operations: ["read"],
      paths: ["/"],
    },
    {
      operations: ["read", "write"],
      paths: expandDirectoryRoots(writableRoots),
    },
    {
      operations: ["read"],
      paths: expandDirectoryRoots(readableRoots),
    },
  ];

  if (options.allowSkillWrites) {
    permissions.splice(2, 0, {
      operations: ["write"],
      paths: expandDirectoryRoots(DEFAULT_READ_ONLY_ROOTS),
    });
  }

  if (options.restrictReads ?? true) {
    permissions.push({
      operations: ["read", "write"],
      paths: ["/**"],
      mode: "deny",
    });
  } else {
    permissions.push({
      operations: ["write"],
      paths: ["/**"],
      mode: "deny",
    });
  }

  return permissions;
}
