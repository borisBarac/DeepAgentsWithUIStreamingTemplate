import { describe, expect, it } from "bun:test";

import { createModelRuntime } from "./runtime.ts";

describe("createModelRuntime", () => {
  it("constructs OpenRouter profiles lazily and caches them by profile", () => {
    let optionReads = 0;
    const providerOptions = Object.defineProperty({}, "topP", {
      enumerable: true,
      get: () => {
        optionReads += 1;
        return 0.8;
      },
    });
    const runtime = createModelRuntime({
      connections: {
        openrouter: {
          provider: "openrouter",
          apiKey: "test-key",
        },
      },
      models: {
        primary: {
          connection: "openrouter",
          model: "anthropic/claude-sonnet-4",
          providerOptions,
        },
      },
      assignments: {
        default: "primary",
      },
    });

    expect(optionReads).toBe(0);
    const first = runtime.getModel("primary");
    const second = runtime.getModel("primary");
    const { getModel } = runtime;

    expect(optionReads).toBe(1);
    expect(first).toBe(second);
    expect(getModel("primary")).toBe(first);
    expect(first.model).toBe("anthropic/claude-sonnet-4");
    expect(first._llmType()).toBe("openrouter");
  });

  it("constructs OpenAI-compatible profiles with the configured endpoint", () => {
    const runtime = createModelRuntime({
      connections: {
        local: {
          provider: "openai-compatible",
          apiKey: "local-key",
          baseURL: "http://localhost:11434/v1",
        },
      },
      models: {
        fast: {
          connection: "local",
          model: "qwen3",
          temperature: 0,
        },
      },
      assignments: {
        default: "fast",
      },
    });

    const model = runtime.getModel("fast");

    expect(model.model).toBe("qwen3");
    expect(model.temperature).toBe(0);
    expect(model._llmType()).toBe("openai");
    expect((model as { clientConfig: { baseURL?: string } }).clientConfig.baseURL).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("uses role overrides before the default assignment", () => {
    const runtime = createModelRuntime({
      connections: {
        openrouter: {
          provider: "openrouter",
          apiKey: "test-key",
        },
      },
      models: {
        primary: { connection: "openrouter", model: "primary-model" },
        fast: { connection: "openrouter", model: "fast-model" },
      },
      assignments: {
        default: "primary",
        clarifier: "fast",
        "image-designer": "fast",
      },
    });

    expect(runtime.getModelForRole("clarifier").model).toBe("fast-model");
    expect(runtime.getModelForRole("image-designer").model).toBe("fast-model");
    expect(runtime.getModelForRole("researcher").model).toBe("primary-model");
  });

  it("fails clearly when a role has no direct or default assignment", () => {
    const runtime = createModelRuntime({
      connections: {
        openrouter: { provider: "openrouter", apiKey: "test-key" },
      },
      models: {
        primary: { connection: "openrouter", model: "primary-model" },
      },
      assignments: {
        reviewer: "primary",
      },
    });

    expect(() => runtime.getModelForRole("researcher")).toThrow(
      'No model assignment configured for role "researcher"',
    );
  });

  it("validates connection, profile, assignment, provider, role, and URL references", () => {
    expect(() =>
      createModelRuntime({
        connections: {},
        models: {},
        assignments: {},
      }),
    ).toThrow("at least one named connection");

    expect(() =>
      createModelRuntime({
        connections: {
          openrouter: { provider: "openrouter" },
        },
        models: {
          primary: { connection: "missing", model: "model" },
        },
        assignments: {},
      }),
    ).toThrow('unknown connection "missing"');

    expect(() =>
      createModelRuntime({
        connections: {
          local: {
            provider: "openai-compatible",
            baseURL: "not-a-url",
          },
        },
        models: {
          primary: { connection: "local", model: "model" },
        },
        assignments: {
          default: "primary",
        },
      }),
    ).toThrow("valid HTTP(S) baseURL");

    expect(() =>
      createModelRuntime({
        connections: {
          openrouter: { provider: "openrouter" },
        },
        models: {
          primary: { connection: "openrouter", model: "model" },
        },
        assignments: {
          default: "missing",
        },
      }),
    ).toThrow('unknown model profile "missing"');

    expect(() =>
      createModelRuntime({
        connections: {
          openrouter: { provider: "anthropic" },
        },
        models: {
          primary: { connection: "openrouter", model: "model" },
        },
        assignments: {
          default: "primary",
        },
      } as unknown as Parameters<typeof createModelRuntime>[0]),
    ).toThrow('unsupported provider "anthropic"');

    expect(() =>
      createModelRuntime({
        connections: {
          openrouter: { provider: "openrouter" },
        },
        models: {
          primary: { connection: "openrouter", model: "model" },
        },
        assignments: {
          planner: "primary",
        },
      } as Parameters<typeof createModelRuntime>[0]),
    ).toThrow('unknown role "planner"');

    expect(() =>
      createModelRuntime({
        connections: {
          " ": { provider: "openrouter" },
        },
        models: {
          primary: { connection: " ", model: "model" },
        },
        assignments: {},
      }),
    ).toThrow("Connection names must be non-empty");

    expect(() =>
      createModelRuntime({
        connections: {
          openrouter: { provider: "openrouter" },
        },
        models: {
          primary: { connection: "openrouter", model: " " },
        },
        assignments: {},
      }),
    ).toThrow('Model profile "primary" must provide a non-empty model ID');
  });

  it("rejects unknown profiles and roles at lookup time", () => {
    const runtime = createModelRuntime({
      connections: {
        openrouter: { provider: "openrouter" },
      },
      models: {
        primary: { connection: "openrouter", model: "model" },
      },
      assignments: {
        default: "primary",
      },
    });

    expect(() => runtime.getModel("missing")).toThrow('Unknown model profile "missing"');
    expect(() => runtime.getModelForRole("planner" as never)).toThrow(
      'Unknown model role "planner"',
    );
  });

  it("does not expose secrets in validation errors", () => {
    const secret = "secret-value-that-must-not-leak";

    try {
      createModelRuntime({
        connections: {
          local: {
            provider: "openai-compatible",
            apiKey: secret,
            baseURL: secret,
          },
        },
        models: {
          primary: { connection: "local", model: "model" },
        },
        assignments: {
          default: "primary",
        },
      });
      throw new Error("Expected runtime creation to fail");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }

    const runtime = createModelRuntime({
      connections: {
        openrouter: {
          provider: "openrouter",
          apiKey: secret,
        },
      },
      models: {
        primary: { connection: "openrouter", model: "model" },
      },
      assignments: {
        default: "primary",
      },
    });
    expect(JSON.stringify(runtime)).not.toContain(secret);
  });
});
