import { describe, expect, it } from "bun:test";

import { runCli } from "./index";

function createDependencies(response = "Agent response") {
  const invocations: unknown[] = [];
  const createAgentOptions: unknown[] = [];
  const dependencies: NonNullable<Parameters<typeof runCli>[1]> = {
    createAgent(options) {
      createAgentOptions.push(options);
      return {
        async invoke(input) {
          invocations.push(input);
          return {
            messages: [{ content: response }],
          };
        },
      };
    },
    getOpenRouterApiKey: () => "test-key",
  };

  return {
    dependencies,
    createAgentOptions,
    invocations,
  };
}

describe("runCli", () => {
  it("prints help text", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Usage:");
  });

  it("prints version text", async () => {
    expect(await runCli(["--version"])).toEqual({
      exitCode: 0,
      output: "0.1.0",
    });
  });

  it("invokes the core agent with the prompt and prints its response", async () => {
    const test = createDependencies("Core works");

    expect(await runCli(["Explain", "the core"], test.dependencies)).toEqual({
      exitCode: 0,
      output: "Core works",
    });
    expect(test.createAgentOptions).toEqual([{ apiKey: "test-key", model: undefined }]);
    expect(test.invocations).toEqual([
      {
        messages: [{ role: "user", content: "Explain the core" }],
      },
    ]);
  });

  it("passes an explicit model to core", async () => {
    const test = createDependencies();

    await runCli(["--model", "openrouter:anthropic/claude-sonnet-4", "Hello"], test.dependencies);

    expect(test.createAgentOptions).toEqual([
      {
        apiKey: "test-key",
        model: "openrouter:anthropic/claude-sonnet-4",
      },
    ]);
  });

  it("reports missing prompts, options, credentials, and runtime failures", async () => {
    const test = createDependencies();

    expect(await runCli([], test.dependencies)).toEqual({
      exitCode: 1,
      output: "A prompt is required. Run with --help for usage.",
    });
    expect(await runCli(["--unknown"], test.dependencies)).toEqual({
      exitCode: 1,
      output: "Unknown option: --unknown",
    });
    expect(
      await runCli(["Hello"], {
        ...test.dependencies,
        getOpenRouterApiKey: () => undefined,
      }),
    ).toEqual({
      exitCode: 1,
      output: "OPENROUTER_API_KEY is required.",
    });
    expect(
      await runCli(["Hello"], {
        ...test.dependencies,
        createAgent: () => ({
          invoke: async () => {
            throw new Error("Provider unavailable");
          },
        }),
      }),
    ).toEqual({
      exitCode: 1,
      output: "Provider unavailable",
    });
  });

  it("extracts text from structured message content", async () => {
    const test = createDependencies();
    test.dependencies.createAgent = () => ({
      invoke: async () => ({
        messages: [
          {
            content: [
              { type: "text", text: "First" },
              { type: "text", text: "Second" },
            ],
          },
        ],
      }),
    });

    expect(await runCli(["Hello"], test.dependencies)).toEqual({
      exitCode: 0,
      output: "First\nSecond",
    });
  });
});
