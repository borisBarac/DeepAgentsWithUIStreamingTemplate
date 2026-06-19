#!/usr/bin/env bun

import { createBaselineAgent } from "@deep-agent-template/core";

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

type CliDependencies = {
  createAgent(options: { apiKey: string; model?: string }): Agent;
  getOpenRouterApiKey(): string | undefined;
};

type CliOptions = {
  model?: string;
  prompt: string;
};

const version = "0.1.0";

const helpText = `deep-agent-template

Usage:
  deep-agent-template [--model <provider:model>] <prompt>
  deep-agent-template --help
  deep-agent-template --version

Environment:
  OPENROUTER_API_KEY  Required for agent requests

Examples:
  deep-agent-template "Explain this project in one sentence"
  deep-agent-template --model openrouter:anthropic/claude-sonnet-4 "Say hello"`;

const defaultDependencies: CliDependencies = {
  createAgent: ({ apiKey, model }) =>
    createBaselineAgent({
      guardrails: false,
      model,
      openRouter: { apiKey },
    }),
  getOpenRouterApiKey: () => process.env.OPENROUTER_API_KEY,
};

function parseOptions(args: string[]): CliOptions {
  const promptParts: string[] = [];
  let model: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--model") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--model requires a provider-prefixed model ID.");
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
  if (!prompt) {
    throw new Error("A prompt is required. Run with --help for usage.");
  }

  return { model, prompt };
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

export async function runCli(
  args: string[],
  dependencies: CliDependencies = defaultDependencies,
): Promise<CliResult> {
  if (args.includes("--help") || args.includes("-h")) {
    return {
      exitCode: 0,
      output: helpText,
    };
  }

  if (args.includes("--version") || args.includes("-v")) {
    return {
      exitCode: 0,
      output: version,
    };
  }

  try {
    const options = parseOptions(args);
    const apiKey = dependencies.getOpenRouterApiKey()?.trim();

    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is required.");
    }

    const agent = dependencies.createAgent({
      apiKey,
      model: options.model,
    });
    const result = await agent.invoke({
      messages: [{ role: "user", content: options.prompt }],
    });

    return {
      exitCode: 0,
      output: extractFinalResponse(result),
    };
  } catch (error) {
    return {
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

if (import.meta.main) {
  const result = await runCli(Bun.argv.slice(2));

  const print = result.exitCode === 0 ? console.log : console.error;
  print(result.output);
  process.exitCode = result.exitCode;
}
