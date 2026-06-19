# CLI

A thin Bun-based command-line frontend for `@deep-agent-template/core`. It parses a prompt and optional model from `argv`, resolves an OpenRouter key from the environment, invokes a baseline agent, and prints the final text response.

The CLI is intentionally minimal: no streaming, no conversation history, no tool interrupts. It exists as a runnable smoke surface over the core agent, not as a product.

## Requirements

- [Bun](https://bun.sh/) runtime. The `bin` entry points directly at TypeScript source (`./src/index.ts`) with a `#!/usr/bin/env bun` shebang; there is no build step.

## Install

The package is private and consumed as a workspace dependency. From the repository root:

```sh
bun install
```

## Usage

From the repository root (bun runs TypeScript directly, no build step):

```sh
OPENROUTER_API_KEY=... bun run packages/cli/src/index.ts "Explain this project in one sentence"
```

Or from within this package:

```sh
bun run src/index.ts "Explain this project in one sentence"
```

As a workspace dependency, the `bin` entry also resolves to `node_modules/.bin/deep-agent-template`:

```sh
./node_modules/.bin/deep-agent-template --model openrouter:anthropic/claude-sonnet-4 "Say hello"
```

## Flags

| Flag | Alias | Description |
| --- | --- | --- |
| `<prompt>` | — | Positional. Multiple tokens are joined with spaces into a single prompt. Required. |
| `--model <id>` | — | Provider-prefixed model id forwarded to core (e.g. `openrouter:anthropic/claude-sonnet-4`). Optional. |
| `--help` | `-h` | Print usage and exit `0`. |
| `--version` | `-v` | Print the package version and exit `0`. |

Any other token starting with `-` is rejected as `Unknown option`. `--model` must be followed by a value that does not itself start with `-`.

## Environment

```sh
OPENROUTER_API_KEY=...   # Required for agent requests
```

## How it wires to core

The default dependency factory calls `createBaselineAgent` from `@deep-agent-template/core` with `guardrails: false`, the resolved `apiKey`, and the optional `model`. The agent's `messages` array is seeded with a single user message containing the joined prompt.

The response is reduced from the agent's `messages` by walking the list in reverse and returning the first message that yields text. Content is accepted as:

- a plain `string`, or
- an array of blocks where each block is a `string` or an object with a string `text` field (multi-block text is joined with `\n`).

If no text can be extracted, the CLI exits `1` with `Core returned no text response.`

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success, `--help`, or `--version`. Output is written to **stdout**. |
| `1` | Missing prompt, unknown flag, missing `OPENROUTER_API_KEY`, or a runtime error from core. Output is written to **stderr**. |

The entrypoint sets `process.exitCode` rather than calling `process.exit()`, so pending I/O (e.g. background trace submission) is not truncated.

## Programmatic API

`runCli` is exported so the same code path can be driven from tests or a host process without spawning a subprocess. All side-effectful collaborators are passed through a `CliDependencies` seam:

```ts
import { runCli } from "@deep-agent-template/cli";

const { exitCode, output } = await runCli(
  ["--model", "openrouter:anthropic/claude-sonnet-4", "Hello"],
  {
    createAgent: ({ apiKey, model }) => ({
      async invoke({ messages }) {
        // ...call core or a test double
        return { messages: [{ content: "Hi" }] };
      },
    }),
    getOpenRouterApiKey: () => process.env.OPENROUTER_API_KEY,
  },
);
```

Omitting the second argument uses `defaultDependencies`, which reads `OPENROUTER_API_KEY` from `process.env` and builds the real baseline agent.

## Tests

```sh
bun test
```

`src/index.test.ts` exercises the full surface through the dependency seam: help/version output, prompt and model parsing, missing-prompt and unknown-option errors, missing-key handling, runtime-failure propagation, and structured (array-of-blocks) content extraction. No live model calls are made.
