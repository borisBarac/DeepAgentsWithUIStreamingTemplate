import { CompositeBackend, StateBackend, StoreBackend } from "deepagents";

import { DEFAULT_MEMORY_ROOT } from "./constants.ts";
import type { CreateCompositeBackendOptions } from "./types.ts";

export function createDefaultCompositeBackend(
  options: CreateCompositeBackendOptions = {},
): CompositeBackend {
  const defaultBackend = options.defaultBackend ?? new StateBackend();
  const memoryBackend =
    options.memoryBackend ??
    new StoreBackend({
      namespace: options.memoryNamespace,
    });

  return new CompositeBackend(defaultBackend, {
    [DEFAULT_MEMORY_ROOT]: memoryBackend,
  });
}
