#!/usr/bin/env bun

import { createGreeting } from "@deep-agent-template/core";

export type CliResult = {
  exitCode: number;
  output: string;
};

const version = "0.1.0";

const helpText = `deep-agent-template

Usage:
  deep-agent-template [name]
  deep-agent-template --help
  deep-agent-template --version`;

export function runCli(args: string[]): CliResult {
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

  const name = args[0];

  return {
    exitCode: 0,
    output: createGreeting({ name }),
  };
}

if (import.meta.main) {
  const result = runCli(Bun.argv.slice(2));

  console.log(result.output);
  process.exit(result.exitCode);
}
