import { describe, expect, it } from "bun:test";
import { CompositeBackend, StateBackend, StoreBackend } from "deepagents";

import { DEFAULT_MEMORY_ROOT } from "./constants.ts";
import { createDefaultCompositeBackend } from "./backend.ts";

describe("composite backend defaults", () => {
  it("wires state and memory backends together", () => {
    const backend = createDefaultCompositeBackend();

    expect(backend).toBeInstanceOf(CompositeBackend);
    expect(backend.routePrefixes).toEqual([DEFAULT_MEMORY_ROOT]);
    expect(backend.routes[DEFAULT_MEMORY_ROOT]).toBeDefined();
  });

  it("respects explicit backend overrides", () => {
    const defaultBackend = new StateBackend();
    const memoryBackend = new StoreBackend();

    const backend = createDefaultCompositeBackend({
      defaultBackend,
      memoryBackend,
    });

    expect(backend).toBeInstanceOf(CompositeBackend);
    expect(backend.routePrefixes).toEqual([DEFAULT_MEMORY_ROOT]);
    expect(backend.routes[DEFAULT_MEMORY_ROOT]).toBeDefined();
  });
});
