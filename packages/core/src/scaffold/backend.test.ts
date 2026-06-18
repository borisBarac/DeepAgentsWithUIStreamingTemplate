import { describe, expect, it } from "bun:test";
import { CompositeBackend, StateBackend, StoreBackend } from "deepagents";
import { createDefaultCompositeBackend } from "./backend.ts";
import { DEFAULT_MEMORY_ROOT } from "./constants.ts";

describe("composite backend defaults", () => {
  it("wires state and memory backends together", () => {
    const backend = createDefaultCompositeBackend();

    expect(backend).toBeInstanceOf(CompositeBackend);
    expect(backend.routePrefixes).toEqual([DEFAULT_MEMORY_ROOT]);
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
  });
});
