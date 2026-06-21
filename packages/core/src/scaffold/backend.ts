import { CompositeBackend, StateBackend, StoreBackend } from "deepagents";

import { createUserMemoryBackend } from "../memory/index.ts";
import { DEFAULT_MEMORY_ROOT } from "./constants.ts";
import type { CreateCompositeBackendOptions } from "./types.ts";

export function createDefaultCompositeBackend(
  options: CreateCompositeBackendOptions = {},
): CompositeBackend {
  const defaultBackend = options.defaultBackend ?? new StateBackend();
  const memoryBackend =
    options.memoryBackend ??
    (options.memoryNamespace
      ? new StoreBackend({
          store: options.memoryStore,
          namespace: options.memoryNamespace,
        })
      : createUserMemoryBackend({
          store: options.memoryStore,
          userId: options.memoryUserId,
        }));

  return new CompositeBackend(defaultBackend, {
    [DEFAULT_MEMORY_ROOT]: memoryBackend,
  });
}
