#!/usr/bin/env bun

import readline from "node:readline/promises";

import {
  type CreateRuntimeScaffoldOptions,
  createBaselineAgent,
  createModelRuntime,
  createRuntimeScaffold,
  createScaffoldedAgent,
  DEFAULT_MODEL_ID,
  type RuntimeScaffold,
} from "@deep-agent-template/core";

export type CliResult = {
  exitCode: number;
  output: string;
};

type AgentResult = {
  messages?: unknown[];
};

type Agent = {
  invoke(input: { messages: Array<{ content: string; role: "user" }> }): Promise<AgentResult>;
};

type AgentRuntime = "baseline" | "scaffolded";

export type OpenAICompatibleEndpoint = {
  apiKey: string;
  baseURL: string;
};

type CreateAgentOptions = {
  apiKey: string;
  baseURL: string;
  model?: string;
  runtime: AgentRuntime;
  systemPrompt?: string;
};

type CliDependencies = {
  createAgent(options: CreateAgentOptions): Agent;
  createScaffold(options?: CreateRuntimeScaffoldOptions): RuntimeScaffold;
  createLineReader?(): AsyncIterable<string>;
  print?(text: string): void;
  getOpenAICompatibleEndpoint?(): OpenAICompatibleEndpoint | undefined;
};

type BaselineOptions = {
  model?: string;
  prompt: string;
};

type ScaffoldOptions = {
  model?: string;
  prompt: string;
  dump: boolean;
  systemPrompt?: string;
};

const version = "0.1.0";

const helpText = `deep-agent-template

Usage:
  deep-agent-template baseline [--model <model>] <prompt>
  deep-agent-template scaffold [--model <model>]
                               [--system-prompt <text> | --system-prompt-file <path>]
                               <prompt>
  deep-agent-template scaffold --dump
  deep-agent-template --help
  deep-agent-template --version

Commands:
  baseline    Run a prompt through the baseline agent
  scaffold    Run a prompt through the scaffolded supervisor-specialists agent

REPL mode:
  Omit the prompt to start an interactive session that reuses one agent across
  multiple prompts (baseline or scaffold). Each line you type is sent as a fresh
  standalone prompt; the agent has no memory of prior turns, but responses stay
  on screen in your scrollback. Blank lines are skipped. Type /quit or /exit (or
  press Ctrl+D) to leave. Example: \`deep-agent-template scaffold\`.

Options:
  --model <model>            Model ID (accepted by both commands). A raw model name for the
                             OpenAI-compatible endpoint (e.g. deepseek-v4-flash). Optional;
                             defaults to ${DEFAULT_MODEL_ID}.
  --system-prompt <text>     Override the supervisor system prompt (scaffold only).
  --system-prompt-file <path>  Read the supervisor system prompt from a file (scaffold only).
  --dump                     Print the resolved runtime scaffold as JSON and exit
                             (scaffold only; no prompt or API key required).

Environment:
  LLM_BASE_URL        Required. Your OpenAI-compatible endpoint
                      (e.g. https://api.deepseek.com).
  LLM_API_KEY         Required. Authenticates against the LLM_BASE_URL endpoint.

Examples:
  deep-agent-template baseline "Explain this project in one sentence"
  deep-agent-template scaffold --model deepseek-v4-flash "Plan a refactor"
  deep-agent-template scaffold --system-prompt "You are a test agent" "Say hello"
  deep-agent-template scaffold --dump`;

const defaultDependencies: CliDependencies = {
  createAgent: ({ apiKey, baseURL, model, runtime, systemPrompt }) => {
    const modelRuntime = createModelRuntime({
      connections: {
        default: { apiKey, baseURL },
      },
      models: {
        default: {
          connection: "default",
          model: model ?? DEFAULT_MODEL_ID,
        },
      },
      assignments: { default: "default" },
    });
    return runtime === "scaffolded"
      ? createScaffoldedAgent({ guardrails: false, modelRuntime, systemPrompt })
      : createBaselineAgent({ guardrails: false, modelRuntime });
  },
  createScaffold: (options) => createRuntimeScaffold(options),
  createLineReader: () =>
    readline.createInterface({ input: process.stdin, output: process.stdout }),
  print: (text) => console.log(text),
  getOpenAICompatibleEndpoint: () => {
    const baseURL = process.env.LLM_BASE_URL?.trim();
    if (!baseURL) {
      return undefined;
    }
    return { apiKey: process.env.LLM_API_KEY ?? "", baseURL };
  },
};

function parseBaselineOptions(args: string[]): BaselineOptions {
  const promptParts: string[] = [];
  let model: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--model") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--model requires a model ID.");
      }
      model = value;
      index += 1;
      continue;
    }

    if (argument?.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    }

    if (argument) {
      promptParts.push(argument);
    }
  }

  const prompt = promptParts.join(" ").trim();

  return { model, prompt };
}

async function parseScaffoldOptions(args: string[]): Promise<ScaffoldOptions> {
  const promptParts: string[] = [];
  let model: string | undefined;
  let inlinePrompt: string | undefined;
  let filePrompt: string | undefined;
  let dump = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--model") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--model requires a model ID.");
      }
      model = value;
      index += 1;
      continue;
    }

    if (argument === "--system-prompt") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--system-prompt requires a value.");
      }
      inlinePrompt = value;
      index += 1;
      continue;
    }

    if (argument === "--system-prompt-file") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--system-prompt-file requires a file path.");
      }
      try {
        filePrompt = await Bun.file(value).text();
      } catch {
        throw new Error(`Cannot read system prompt file: ${value}`);
      }
      index += 1;
      continue;
    }

    if (argument === "--dump") {
      dump = true;
      continue;
    }

    if (argument?.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    }

    if (argument) {
      promptParts.push(argument);
    }
  }

  if (inlinePrompt !== undefined && filePrompt !== undefined) {
    throw new Error("Use either --system-prompt or --system-prompt-file, not both.");
  }

  const prompt = promptParts.join(" ").trim();
  if (dump && prompt) {
    throw new Error("--dump cannot be combined with a prompt.");
  }

  return {
    model,
    prompt,
    dump,
    systemPrompt: inlinePrompt ?? filePrompt,
  };
}

function resolveCredentials(dependencies: CliDependencies): { apiKey: string; baseURL: string } {
  const endpoint = dependencies.getOpenAICompatibleEndpoint?.();
  const baseURL = endpoint?.baseURL.trim() ?? "";
  const apiKey = endpoint?.apiKey.trim() ?? "";

  if (!baseURL) {
    throw new Error(
      "LLM_BASE_URL is required. Set it to your OpenAI-compatible endpoint (e.g. https://api.deepseek.com).",
    );
  }
  if (!apiKey) {
    throw new Error("LLM_API_KEY is required.");
  }

  return { apiKey, baseURL };
}

function extractTextContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }
      if (
        typeof block === "object" &&
        block !== null &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return block.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");

  return text || undefined;
}

function extractFinalResponse(result: AgentResult): string {
  const messages = result.messages;
  if (!Array.isArray(messages)) {
    throw new Error("Core returned no messages.");
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (typeof message !== "object" || message === null || !("content" in message)) {
      continue;
    }

    const content = extractTextContent(message.content);
    if (content) {
      return content;
    }
  }

  throw new Error("Core returned no text response.");
}

async function runRepl(agent: Agent, dependencies: CliDependencies): Promise<CliResult> {
  const reader = dependencies.createLineReader?.() ?? createDefaultLineReader();
  const print = dependencies.print ?? ((text: string) => console.log(text));
  print("REPL ready. Each line is a fresh prompt. Type /quit or /exit (or Ctrl+D) to exit.");

  try {
    for await (const raw of reader) {
      const line = raw.trim();
      if (!line) {
        continue;
      }
      if (line === "/quit" || line === "/exit") {
        break;
      }
      try {
        const result = await agent.invoke({
          messages: [{ role: "user", content: line }],
        });
        print(extractFinalResponse(result));
      } catch (error) {
        print(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    (reader as { close?: () => void }).close?.();
  }

  return { exitCode: 0, output: "" };
}

function createDefaultLineReader(): AsyncIterable<string> {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function serializeScaffold(scaffold: RuntimeScaffold): unknown {
  return {
    architecture: scaffold.architecture,
    virtualFilesystem: scaffold.virtualFilesystem,
    memoryFilePaths: scaffold.memoryFilePaths,
    memory: scaffold.memory,
    interruptOn: scaffold.interruptOn,
    permissions: scaffold.permissions,
    clarification: scaffold.clarification,
    systemPrompt: scaffold.systemPrompt,
    subagents: scaffold.subagents.map((subagent) => {
      const s = subagent as {
        name?: string;
        description?: string;
        systemPrompt?: string;
        interruptOn?: unknown;
        tools?: unknown;
        skills?: unknown;
        responseFormat?: unknown;
        model?: unknown;
      };
      return {
        name: s.name,
        description: s.description,
        systemPrompt: s.systemPrompt,
        interruptOn: s.interruptOn,
        tools: s.tools,
        skills: s.skills,
        hasResponseFormat: s.responseFormat !== undefined,
        hasModel: s.model !== undefined,
      };
    }),
  };
}

async function runBaseline(args: string[], dependencies: CliDependencies): Promise<CliResult> {
  try {
    const options = parseBaselineOptions(args);
    const { apiKey, baseURL } = resolveCredentials(dependencies);
    const agent = dependencies.createAgent({
      apiKey,
      baseURL,
      model: options.model,
      runtime: "baseline",
    });

    if (options.prompt) {
      const result = await agent.invoke({
        messages: [{ role: "user", content: options.prompt }],
      });
      return { exitCode: 0, output: extractFinalResponse(result) };
    }

    return runRepl(agent, dependencies);
  } catch (error) {
    return { exitCode: 1, output: error instanceof Error ? error.message : String(error) };
  }
}

async function runScaffold(args: string[], dependencies: CliDependencies): Promise<CliResult> {
  try {
    const options = await parseScaffoldOptions(args);

    if (options.dump) {
      const scaffold = dependencies.createScaffold(
        options.systemPrompt ? { systemPrompt: options.systemPrompt } : undefined,
      );
      return {
        exitCode: 0,
        output: JSON.stringify(serializeScaffold(scaffold), null, 2),
      };
    }

    const { apiKey, baseURL } = resolveCredentials(dependencies);
    const agent = dependencies.createAgent({
      apiKey,
      baseURL,
      model: options.model,
      runtime: "scaffolded",
      ...(options.systemPrompt !== undefined && { systemPrompt: options.systemPrompt }),
    });

    if (options.prompt) {
      const result = await agent.invoke({
        messages: [{ role: "user", content: options.prompt }],
      });
      return { exitCode: 0, output: extractFinalResponse(result) };
    }

    return runRepl(agent, dependencies);
  } catch (error) {
    return { exitCode: 1, output: error instanceof Error ? error.message : String(error) };
  }
}

export async function runCli(
  args: string[],
  dependencies: CliDependencies = defaultDependencies,
): Promise<CliResult> {
  if (args.includes("--help") || args.includes("-h")) {
    return { exitCode: 0, output: helpText };
  }

  if (args.includes("--version") || args.includes("-v")) {
    return { exitCode: 0, output: version };
  }

  const [command, ...rest] = args;

  if (!command) {
    return {
      exitCode: 1,
      output: "A command is required (baseline | scaffold). Run with --help for usage.",
    };
  }

  if (command === "baseline") {
    return runBaseline(rest, dependencies);
  }

  if (command === "scaffold") {
    return runScaffold(rest, dependencies);
  }

  return { exitCode: 1, output: `Unknown command: ${command}. Run with --help for usage.` };
}

if (import.meta.main) {
  const result = await runCli(Bun.argv.slice(2));

  if (result.output) {
    const print = result.exitCode === 0 ? console.log : console.error;
    print(result.output);
  }
  process.exitCode = result.exitCode;
}
