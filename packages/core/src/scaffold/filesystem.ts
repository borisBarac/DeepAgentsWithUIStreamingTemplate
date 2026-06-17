import {
  DEFAULT_ARTIFACTS_ROOT,
  DEFAULT_MEMORY_ROOT,
  DEFAULT_PLANS_ROOT,
  DEFAULT_REPORTS_ROOT,
  DEFAULT_SCRATCH_ROOT,
  DEFAULT_SKILLS_ROOT,
} from "./constants.ts";
import type { VirtualFilesystemLayout } from "./types.ts";

export function createVirtualFilesystemLayout(): VirtualFilesystemLayout {
  return {
    scratch: DEFAULT_SCRATCH_ROOT,
    plans: DEFAULT_PLANS_ROOT,
    reports: DEFAULT_REPORTS_ROOT,
    artifacts: DEFAULT_ARTIFACTS_ROOT,
    memory: DEFAULT_MEMORY_ROOT,
    skills: DEFAULT_SKILLS_ROOT,
  };
}
