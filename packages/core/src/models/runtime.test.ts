import { describe, expect, it } from "bun:test";

import { MODEL_CATEGORIES } from "./constants.ts";
import { createModelRuntimeFromEnvValues } from "./env.ts";
import { createModelRuntime } from "./runtime.ts";

const OPENROUTER_CONNECTION = {
  openrouter: { provider: "openrouter", apiKey: "test-key" },
} as const;

describe("createModelRuntime", () => {
  it("constructs category models lazily and caches them by category", () => {
    let optionReads = 0;
    const providerOptions = Object.defineProperty({}, "topP", {
      enumerable: true,
      get: () => {
        optionReads += 1;
        return 0.8;
      },
    });
    const runtime = createModelRuntime({
      connections: { ...OPENROUTER_CONNECTION },
      categories: {
        fast: { connection: "openrouter", model: "fast-model" },
        normal: { connection: "openrouter", model: "anthropic/claude-sonnet-4", providerOptions },
        pro: { connection: "openrouter", model: "pro-model" },
      },
      assignments: { default: "normal" },
    });

    expect(optionReads).toBe(0);
    const first = runtime.getModelForCategory("normal");
    const second = runtime.getModelForCategory("normal");

    expect(optionReads).toBe(1);
    expect(first).toBe(second);
    expect(first.model).toBe("anthropic/claude-sonnet-4");
    expect(first._llmType()).toBe("openrouter");
  });

  it("constructs OpenAI-compatible categories with the configured endpoint", () => {
    const runtime = createModelRuntime({
      connections: {
        local: {
          provider: "openai-compatible",
          apiKey: "local-key",
          baseURL: "http://localhost:11434/v1",
        },
      },
      categories: {
        fast: { connection: "local", model: "qwen3", temperature: 0 },
        normal: { connection: "local", model: "qwen3" },
        pro: { connection: "local", model: "qwen3" },
      },
      assignments: { default: "fast" },
    });

    const model = runtime.getModelForCategory("fast");

    expect(model.model).toBe("qwen3");
    expect(model.temperature).toBe(0);
    expect(model._llmType()).toBe("openai");
    expect((model as { clientConfig: { baseURL?: string } }).clientConfig.baseURL).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("resolves a role via its category assignment before the default", () => {
    const runtime = createModelRuntime({
      connections: { ...OPENROUTER_CONNECTION },
      categories: {
        fast: { connection: "openrouter", model: "fast-model" },
        normal: { connection: "openrouter", model: "normal-model" },
        pro: { connection: "openrouter", model: "pro-model" },
      },
      assignments: {
        default: "normal",
        clarifier: "fast",
        "image-designer": "fast",
        reviewer: "pro",
      },
    });

    expect(runtime.getModelForRole("clarifier").model).toBe("fast-model");
    expect(runtime.getModelForRole("image-designer").model).toBe("fast-model");
    expect(runtime.getModelForRole("researcher").model).toBe("normal-model");
    expect(runtime.getModelForRole("reviewer").model).toBe("pro-model");
  });

  it("exposes the resolved category for a role, falling back to default then normal", () => {
    const runtime = createModelRuntime({
      connections: { ...OPENROUTER_CONNECTION },
      categories: {
        fast: { connection: "openrouter", model: "fast-model" },
        normal: { connection: "openrouter", model: "normal-model" },
        pro: { connection: "openrouter", model: "pro-model" },
      },
      assignments: { clarifier: "fast" },
    });

    expect(runtime.getCategoryForRole("clarifier")).toBe("fast");
    expect(runtime.getCategoryForRole("researcher")).toBe("normal");
  });

  it("reports whether a role is resolvable", () => {
    const runtime = createModelRuntime({
      connections: { ...OPENROUTER_CONNECTION },
      categories: {
        fast: { connection: "openrouter", model: "fast-model" },
        normal: { connection: "openrouter", model: "normal-model" },
        pro: { connection: "openrouter", model: "pro-model" },
      },
      assignments: { clarifier: "fast" },
    });

    expect(runtime.hasModelForRole("clarifier")).toBe(true);
    // No `default` set, but every role still resolves to the "normal" fallback.
    expect(runtime.hasModelForRole("researcher")).toBe(false);
  });

  it("validates connections, categories, assignments, providers, roles, and URLs", () => {
    expect(() =>
      createModelRuntime({
        connections: {},
        categories: {
          fast: { connection: "x", model: "m" },
          normal: { connection: "x", model: "m" },
          pro: { connection: "x", model: "m" },
        },
        assignments: {},
      }),
    ).toThrow("at least one named connection");

    expect(() =>
      createModelRuntime({
        connections: { openrouter: { provider: "openrouter" } },
        categories: {
          fast: { connection: "missing", model: "model" },
          normal: { connection: "openrouter", model: "model" },
          pro: { connection: "openrouter", model: "model" },
        },
        assignments: {},
      }),
    ).toThrow('unknown connection "missing"');

    expect(() =>
      createModelRuntime({
        connections: {
          local: { provider: "openai-compatible", baseURL: "not-a-url" },
        },
        categories: {
          fast: { connection: "local", model: "model" },
          normal: { connection: "local", model: "model" },
          pro: { connection: "local", model: "model" },
        },
        assignments: { default: "normal" },
      }),
    ).toThrow("valid HTTP(S) baseURL");

    expect(() =>
      createModelRuntime({
        connections: { openrouter: { provider: "openrouter" } },
        categories: {
          fast: { connection: "openrouter", model: "model" },
          normal: { connection: "openrouter", model: " " },
          pro: { connection: "openrouter", model: "model" },
        },
        assignments: {},
      }),
    ).toThrow('Category "normal" must provide a non-empty model ID');

    expect(() =>
      createModelRuntime({
        connections: { openrouter: { provider: "openrouter" } },
        categories: {
          fast: { connection: "openrouter", model: "model" },
          normal: { connection: "openrouter", model: "model" },
          pro: { connection: "openrouter", model: "model" },
        },
        assignments: { default: "missing" as never },
      }),
    ).toThrow('unknown model category "missing"');

    expect(() =>
      createModelRuntime({
        connections: { openrouter: { provider: "anthropic" as never } },
        categories: {
          fast: { connection: "openrouter", model: "model" },
          normal: { connection: "openrouter", model: "model" },
          pro: { connection: "openrouter", model: "model" },
        },
        assignments: { default: "normal" },
      } as unknown as Parameters<typeof createModelRuntime>[0]),
    ).toThrow('unsupported provider "anthropic"');

    expect(() =>
      createModelRuntime({
        connections: { openrouter: { provider: "openrouter" } },
        categories: {
          fast: { connection: "openrouter", model: "model" },
          normal: { connection: "openrouter", model: "model" },
          pro: { connection: "openrouter", model: "model" },
        },
        assignments: { planner: "normal" },
      } as Parameters<typeof createModelRuntime>[0]),
    ).toThrow('unknown role "planner"');

    expect(() =>
      createModelRuntime({
        connections: { " ": { provider: "openrouter" } },
        categories: {
          fast: { connection: " ", model: "model" },
          normal: { connection: " ", model: "model" },
          pro: { connection: " ", model: "model" },
        },
        assignments: {},
      }),
    ).toThrow("Connection names must be non-empty");
  });

  it("rejects unknown categories and roles at lookup time", () => {
    const runtime = createModelRuntime({
      connections: { ...OPENROUTER_CONNECTION },
      categories: {
        fast: { connection: "openrouter", model: "model" },
        normal: { connection: "openrouter", model: "model" },
        pro: { connection: "openrouter", model: "model" },
      },
      assignments: { default: "normal" },
    });

    expect(() => runtime.getModelForCategory("missing" as never)).toThrow(
      'Unknown model category "missing"',
    );
    expect(() => runtime.getModelForRole("planner" as never)).toThrow(
      'Unknown model role "planner"',
    );
  });

  it("does not expose secrets in validation errors", () => {
    const secret = "secret-value-that-must-not-leak";

    try {
      createModelRuntime({
        connections: {
          local: { provider: "openai-compatible", apiKey: secret, baseURL: secret },
        },
        categories: {
          fast: { connection: "local", model: "model" },
          normal: { connection: "local", model: "model" },
          pro: { connection: "local", model: "model" },
        },
        assignments: { default: "normal" },
      });
      throw new Error("Expected runtime creation to fail");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }

    const runtime = createModelRuntime({
      connections: { openrouter: { provider: "openrouter", apiKey: secret } },
      categories: {
        fast: { connection: "openrouter", model: "model" },
        normal: { connection: "openrouter", model: "model" },
        pro: { connection: "openrouter", model: "model" },
      },
      assignments: { default: "normal" },
    });
    expect(JSON.stringify(runtime)).not.toContain(secret);
  });
});

describe("createModelRuntimeFromEnvValues", () => {
  function envWith(normalModel: string, overrides: Partial<Record<string, string>> = {}) {
    return {
      baseURL: "https://api.example.com/v1",
      apiKey: "key",
      fastModel: overrides.FAST_MODEL ?? normalModel,
      normalModel,
      proModel: overrides.PRO_MODEL ?? normalModel,
    };
  }

  it("falls every category back to the normal model when FAST/PRO are unset", () => {
    const runtime = createModelRuntimeFromEnvValues(envWith("shared-model"));
    for (const category of MODEL_CATEGORIES) {
      expect(runtime.getModelForCategory(category).model).toBe("shared-model");
    }
  });

  it("lets FAST_MODEL and PRO_MODEL override independently", () => {
    const runtime = createModelRuntimeFromEnvValues(
      envWith("normal-model", {
        FAST_MODEL: "cheap-model",
        PRO_MODEL: "heavy-model",
      }),
    );

    expect(runtime.getModelForCategory("fast").model).toBe("cheap-model");
    expect(runtime.getModelForCategory("normal").model).toBe("normal-model");
    expect(runtime.getModelForCategory("pro").model).toBe("heavy-model");
  });

  it("applies the default role -> category assignments", () => {
    const runtime = createModelRuntimeFromEnvValues(
      envWith("normal-model", {
        FAST_MODEL: "fast-model",
        PRO_MODEL: "pro-model",
      }),
    );

    expect(runtime.getCategoryForRole("clarifier")).toBe("fast");
    expect(runtime.getCategoryForRole("researcher")).toBe("normal");
    expect(runtime.getCategoryForRole("supervisor")).toBe("pro");
    expect(runtime.getCategoryForRole("reviewer")).toBe("pro");
  });
});
