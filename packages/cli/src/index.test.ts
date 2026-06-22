import { describe, expect, it } from "bun:test";
import { unlink } from "node:fs/promises";

import { CLARIFY_DEEPLY_SKILL_DIR, createRuntimeScaffold } from "@deep-agent-template/core";

import { runCli } from "./index";

const DEFAULT_ENDPOINT = {
  apiKey: "test-key",
  baseURL: "https://api.deepseek.com",
};

function createDependencies(response = "Agent response") {
  const invocations: unknown[] = [];
  const createAgentOptions: unknown[] = [];
  const createScaffoldCalls: unknown[] = [];
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
    createScaffold: (options) => {
      createScaffoldCalls.push(options ?? null);
      return createRuntimeScaffold(options);
    },
    getOpenAICompatibleEndpoint: () => ({ ...DEFAULT_ENDPOINT }),
  };

  return {
    dependencies,
    createAgentOptions,
    createScaffoldCalls,
    invocations,
  };
}

async function* lines(values: string[]): AsyncIterable<string> {
  for (const value of values) {
    yield value;
  }
}

describe("runCli", () => {
  it("prints help text", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Usage:");
    expect(result.output).toContain("baseline");
    expect(result.output).toContain("scaffold");
    expect(result.output).toContain("REPL");
  });

  it("prints version text", async () => {
    expect(await runCli(["--version"])).toEqual({
      exitCode: 0,
      output: "0.1.0",
    });
  });

  it("invokes the core agent with the prompt and prints its response", async () => {
    const test = createDependencies("Core works");

    expect(await runCli(["baseline", "Explain", "the core"], test.dependencies)).toEqual({
      exitCode: 0,
      output: "Core works",
    });
    expect(test.createAgentOptions).toEqual([
      {
        apiKey: "test-key",
        baseURL: "https://api.deepseek.com",
        model: undefined,
        runtime: "baseline",
      },
    ]);
    expect(test.invocations).toEqual([
      {
        messages: [{ role: "user", content: "Explain the core" }],
      },
    ]);
  });

  it("passes an explicit model to core", async () => {
    const test = createDependencies();

    await runCli(["baseline", "--model", "deepseek-v4-flash", "Hello"], test.dependencies);

    expect(test.createAgentOptions).toEqual([
      {
        apiKey: "test-key",
        baseURL: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        runtime: "baseline",
      },
    ]);
  });

  it("routes the prompt through the scaffolded agent via the scaffold command", async () => {
    const test = createDependencies("Scaffolded works");

    expect(await runCli(["scaffold", "Plan", "it"], test.dependencies)).toEqual({
      exitCode: 0,
      output: "Scaffolded works",
    });
    expect(test.createAgentOptions).toEqual([
      {
        apiKey: "test-key",
        baseURL: "https://api.deepseek.com",
        model: undefined,
        runtime: "scaffolded",
      },
    ]);
    expect(test.invocations).toEqual([{ messages: [{ role: "user", content: "Plan it" }] }]);
  });

  it("forwards an inline system-prompt override for the scaffold command", async () => {
    const test = createDependencies("Scaffolded works");

    await runCli(["scaffold", "--system-prompt", "You are a test agent", "Hi"], test.dependencies);

    expect(test.createAgentOptions).toEqual([
      {
        apiKey: "test-key",
        baseURL: "https://api.deepseek.com",
        model: undefined,
        runtime: "scaffolded",
        systemPrompt: "You are a test agent",
      },
    ]);
  });

  it("reads the system prompt from a file for the scaffold command", async () => {
    const test = createDependencies();
    const tmpPath = `${import.meta.dir}/.tmp-prompt-${process.pid}-${Date.now()}.md`;
    await Bun.write(tmpPath, "File prompt body");

    try {
      await runCli(["scaffold", "--system-prompt-file", tmpPath, "Hi"], test.dependencies);
    } finally {
      await unlink(tmpPath);
    }

    expect(test.createAgentOptions).toEqual([
      {
        apiKey: "test-key",
        baseURL: "https://api.deepseek.com",
        model: undefined,
        runtime: "scaffolded",
        systemPrompt: "File prompt body",
      },
    ]);
  });

  it("rejects both system-prompt flags at once", async () => {
    const test = createDependencies();
    const tmpPath = `${import.meta.dir}/.tmp-prompt-${process.pid}-${Date.now()}.md`;
    await Bun.write(tmpPath, "File prompt body");

    try {
      expect(
        await runCli(
          ["scaffold", "--system-prompt", "inline", "--system-prompt-file", tmpPath, "Hi"],
          test.dependencies,
        ),
      ).toEqual({
        exitCode: 1,
        output: "Use either --system-prompt or --system-prompt-file, not both.",
      });
    } finally {
      await unlink(tmpPath);
    }
    expect(test.createAgentOptions).toEqual([]);
  });

  it("honors a custom OpenAI-compatible endpoint when one is provided", async () => {
    const test = createDependencies("Compatible works");
    test.dependencies.getOpenAICompatibleEndpoint = () => ({
      apiKey: "compatible-key",
      baseURL: "https://api.openai.com",
    });

    expect(await runCli(["baseline", "Hello"], test.dependencies)).toEqual({
      exitCode: 0,
      output: "Compatible works",
    });
    expect(test.createAgentOptions).toEqual([
      {
        apiKey: "compatible-key",
        baseURL: "https://api.openai.com",
        model: undefined,
        runtime: "baseline",
      },
    ]);
  });

  it("forwards an explicit model to the OpenAI-compatible endpoint", async () => {
    const test = createDependencies();
    test.dependencies.getOpenAICompatibleEndpoint = () => ({
      apiKey: "compatible-key",
      baseURL: "https://api.openai.com",
    });

    await runCli(["baseline", "--model", "deepseek-reasoner", "Hello"], test.dependencies);

    expect(test.createAgentOptions).toEqual([
      {
        apiKey: "compatible-key",
        baseURL: "https://api.openai.com",
        model: "deepseek-reasoner",
        runtime: "baseline",
      },
    ]);
  });

  it("requires LLM_API_KEY when LLM_BASE_URL is set", async () => {
    const test = createDependencies();
    test.dependencies.getOpenAICompatibleEndpoint = () => ({
      apiKey: "",
      baseURL: "https://api.deepseek.com",
    });

    expect(await runCli(["baseline", "Hello"], test.dependencies)).toEqual({
      exitCode: 1,
      output: "LLM_API_KEY is required.",
    });
    expect(test.createAgentOptions).toEqual([]);
  });

  it("prints a JSON view of the scaffold with scaffold --dump without invoking an agent", async () => {
    const test = createDependencies();

    const result = await runCli(["scaffold", "--dump"], test.dependencies);

    expect(result.exitCode).toBe(0);
    expect(test.createAgentOptions).toEqual([]);
    expect(test.invocations).toEqual([]);
    expect(test.createScaffoldCalls).toEqual([null]);

    const scaffold = JSON.parse(result.output);
    expect(scaffold.architecture).toBe("supervisor-specialists");
    expect(scaffold.virtualFilesystem).toEqual({
      scratch: "/scratch",
      plans: "/plans",
      reports: "/reports",
      artifacts: "/artifacts",
      memory: "/memory",
      skills: "/skills",
    });
    expect(scaffold.interruptOn).toBeUndefined();
    expect(scaffold.backend).toBeUndefined();
    expect(scaffold.clarification.requiredSubagent).toBe("clarifier");
    expect(scaffold.subagents.map((subagent: { name: string }) => subagent.name)).toEqual([
      "clarifier",
      "researcher",
      "analyst",
      "review-agent",
    ]);
    const subagents = scaffold.subagents as Array<{
      name: string;
      hasResponseFormat: boolean;
      hasModel: boolean;
      skills: unknown;
    }>;
    const byName = (name: string) => subagents.find((subagent) => subagent.name === name);
    expect(byName("clarifier")?.hasResponseFormat).toBe(true);
    expect(byName("researcher")?.hasResponseFormat).toBe(false);
    expect(byName("review-agent")?.hasResponseFormat).toBe(true);
    expect(byName("clarifier")?.skills).toEqual([CLARIFY_DEEPLY_SKILL_DIR]);
    for (const subagent of subagents) {
      expect(subagent.hasModel).toBe(false);
    }
  });

  it("does not require credentials for scaffold --dump", async () => {
    const test = createDependencies();

    const result = await runCli(["scaffold", "--dump"], {
      ...test.dependencies,
      getOpenAICompatibleEndpoint: () => undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(() => JSON.parse(result.output)).not.toThrow();
  });

  it("honors --system-prompt when dumping the scaffold", async () => {
    const test = createDependencies();

    const result = await runCli(
      ["scaffold", "--dump", "--system-prompt", "OVERRIDE"],
      test.dependencies,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output).systemPrompt).toBe("OVERRIDE");
    expect(test.createScaffoldCalls).toEqual([{ systemPrompt: "OVERRIDE" }]);
  });

  it("reports unknown options, missing credentials, and runtime failures", async () => {
    const test = createDependencies();

    expect(await runCli(["baseline", "--unknown"], test.dependencies)).toEqual({
      exitCode: 1,
      output: "Unknown option: --unknown",
    });
    expect(
      await runCli(["baseline", "Hello"], {
        ...test.dependencies,
        getOpenAICompatibleEndpoint: () => undefined,
      }),
    ).toEqual({
      exitCode: 1,
      output:
        "LLM_BASE_URL is required. Set it to your OpenAI-compatible endpoint (e.g. https://api.deepseek.com).",
    });
    expect(
      await runCli(["baseline", "Hello"], {
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

  it("rejects scaffold-only options on the baseline command", async () => {
    const test = createDependencies();

    expect(await runCli(["baseline", "--system-prompt", "X", "Hi"], test.dependencies)).toEqual({
      exitCode: 1,
      output: "Unknown option: --system-prompt",
    });
    expect(await runCli(["baseline", "--dump"], test.dependencies)).toEqual({
      exitCode: 1,
      output: "Unknown option: --dump",
    });
  });

  it("rejects combining --dump with a prompt", async () => {
    const test = createDependencies();

    expect(await runCli(["scaffold", "--dump", "Hi"], test.dependencies)).toEqual({
      exitCode: 1,
      output: "--dump cannot be combined with a prompt.",
    });
  });

  it("reports missing and unknown commands", async () => {
    const test = createDependencies();

    expect(await runCli([], test.dependencies)).toEqual({
      exitCode: 1,
      output: "A command is required (baseline | scaffold). Run with --help for usage.",
    });
    expect(await runCli(["bogus"], test.dependencies)).toEqual({
      exitCode: 1,
      output: "Unknown command: bogus. Run with --help for usage.",
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

    expect(await runCli(["baseline", "Hello"], test.dependencies)).toEqual({
      exitCode: 0,
      output: "First\nSecond",
    });
  });

  it("enters a stateless REPL when baseline is given no prompt", async () => {
    const test = createDependencies("Reply");
    const outputs: string[] = [];

    const result = await runCli(["baseline"], {
      ...test.dependencies,
      createLineReader: () => lines(["first", "second"]),
      print: (text) => outputs.push(text),
    });

    expect(result).toEqual({ exitCode: 0, output: "" });
    expect(test.invocations).toHaveLength(2);
    expect(outputs.filter((line) => line === "Reply")).toHaveLength(2);
    expect(test.invocations[1]).toEqual({
      messages: [{ role: "user", content: "second" }],
    });
  });

  it("enters a REPL when scaffold is given no prompt and honors --system-prompt", async () => {
    const test = createDependencies("Reply");
    const outputs: string[] = [];

    const result = await runCli(["scaffold", "--system-prompt", "You are a test agent"], {
      ...test.dependencies,
      createLineReader: () => lines(["hi"]),
      print: (text) => outputs.push(text),
    });

    expect(result).toEqual({ exitCode: 0, output: "" });
    expect(test.createAgentOptions).toEqual([
      {
        apiKey: "test-key",
        baseURL: "https://api.deepseek.com",
        model: undefined,
        runtime: "scaffolded",
        systemPrompt: "You are a test agent",
      },
    ]);
    expect(test.invocations).toEqual([{ messages: [{ role: "user", content: "hi" }] }]);
    expect(outputs).toContain("Reply");
  });

  it("keeps scaffold --dump out of the REPL", async () => {
    const test = createDependencies();

    const result = await runCli(["scaffold", "--dump"], test.dependencies);

    expect(result.exitCode).toBe(0);
    expect(test.createAgentOptions).toEqual([]);
    expect(() => JSON.parse(result.output)).not.toThrow();
  });

  it("skips blank lines and exits the REPL on /quit, /exit, or EOF", async () => {
    const test = createDependencies("Reply");

    await runCli(["baseline"], {
      ...test.dependencies,
      createLineReader: () => lines(["   ", "/quit", "ignored-after-quit"]),
      print: () => {},
    });
    expect(test.invocations).toEqual([]);

    await runCli(["baseline"], {
      ...test.dependencies,
      createLineReader: () => lines(["/exit", "ignored"]),
      print: () => {},
    });
    expect(test.invocations).toEqual([]);

    await runCli(["baseline"], {
      ...test.dependencies,
      createLineReader: () => lines(["real", ""]),
      print: () => {},
    });
    expect(test.invocations).toEqual([{ messages: [{ role: "user", content: "real" }] }]);
  });

  it("prints per-turn errors and keeps the REPL running", async () => {
    const outputs: string[] = [];
    let calls = 0;
    const dependencies: NonNullable<Parameters<typeof runCli>[1]> = {
      createAgent: () => ({
        invoke: async () => {
          calls += 1;
          if (calls === 1) {
            throw new Error("Boom");
          }
          return { messages: [{ content: "OK" }] };
        },
      }),
      createScaffold: (options) => createRuntimeScaffold(options),
      createLineReader: () => lines(["bad", "good"]),
      print: (text) => outputs.push(text),
      getOpenAICompatibleEndpoint: () => ({ ...DEFAULT_ENDPOINT }),
    };

    const result = await runCli(["scaffold"], dependencies);

    expect(result).toEqual({ exitCode: 0, output: "" });
    expect(outputs).toContain("Boom");
    expect(outputs).toContain("OK");
  });
});
