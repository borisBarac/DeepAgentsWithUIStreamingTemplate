# CLI

A thin Bun-based command-line frontend for `@deep-agent-template/core`. It exposes two subcommands — `baseline` and `scaffold` — that resolve model credentials from the environment, invoke the corresponding core agent, and print the final text response. Either command can also drop into a stateless REPL when no prompt is supplied.

The CLI is intentionally minimal: no streaming, no conversation history, no tool interrupts. It exists as a runnable smoke surface over the core agents, not as a product.

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
LLM_BASE_URL=https://api.deepseek.com LLM_API_KEY=... bun run packages/cli/src/index.ts baseline "Explain this project in one sentence"
```

Or from within this package:

```sh
bun run src/index.ts scaffold --model deepseek-v4-flash "Plan a refactor"
```

As a workspace dependency, the `bin` entry also resolves to `node_modules/.bin/deep-agent-template`:

```sh
./node_modules/.bin/deep-agent-template scaffold "Plan a refactor"
```

Print the resolved runtime scaffold as JSON (no prompt or API key required):

```sh
./node_modules/.bin/deep-agent-template scaffold --dump
```

## Commands

| Command | Description |
| --- | --- |
| `baseline <prompt>` | Run a prompt through the baseline agent (`createBaselineAgent`). |
| `scaffold <prompt>` | Run a prompt through the scaffolded supervisor-specialists agent (`createScaffoldedAgent`). |
| `scaffold --dump` | Print the resolved runtime scaffold as JSON and exit. No prompt or API key required. |

A command is **required**. Running with no command, or with an unrecognized command, exits `1`.

## Flags

| Flag | Applies to | Description |
| --- | --- | --- |
| `<prompt>` | `baseline`, `scaffold` | Positional. Multiple tokens are joined with spaces into a single prompt. Optional — omit it to enter the REPL. |
| `--model <id>` | `baseline`, `scaffold` | Raw model name forwarded to the OpenAI-compatible endpoint (e.g. `deepseek-v4-flash`). Optional; defaults to `deepseek-v4-flash`. |
| `--system-prompt <text>` | `scaffold` only | Override the supervisor system prompt with an inline string. Mutually exclusive with `--system-prompt-file`. |
| `--system-prompt-file <path>` | `scaffold` only | Read the supervisor system prompt from a file. Mutually exclusive with `--system-prompt`. |
| `--dump` | `scaffold` only | Print the resolved runtime scaffold as JSON and exit. Cannot be combined with a prompt. No API key required. |
| `--help` / `-h` | global | Print usage and exit `0`. |
| `--version` / `-v` | global | Print the package version and exit `0`. |

Scaffold-only flags (`--system-prompt`, `--system-prompt-file`, `--dump`) are rejected as `Unknown option` on the `baseline` command. Any other token starting with `-` is also rejected as `Unknown option`. `--model`, `--system-prompt`, and `--system-prompt-file` must each be followed by a value that does not itself start with `-`.

## REPL mode

Omit the prompt on either command to start an interactive session that reuses **one** agent across multiple prompts (baseline or scaffold). Each line you type is sent as a fresh standalone prompt — the agent has no memory of prior turns, but responses stay on screen in your scrollback.

- Blank lines are skipped.
- Type `/quit` or `/exit` (or press `Ctrl+D`) to leave.
- Per-turn runtime errors are printed to the same output stream but do **not** terminate the REPL; the session keeps accepting input.
- The REPL always exits `0`.

Example:

```sh
deep-agent-template scaffold --system-prompt "You are a test agent"
```

## Environment

These env vars are required for live agent calls (except for `scaffold --dump`):

```sh
# Your OpenAI-compatible endpoint (e.g. DeepSeek, OpenAI, Ollama, vLLM).
LLM_BASE_URL=https://api.deepseek.com

# Authenticates against the LLM_BASE_URL endpoint.
LLM_API_KEY=...

# Authenticates the default OpenAI moderation safety guardrail.
OPENAI_API_KEY=...
```

With no explicit `--model`, the model defaults to `deepseek-v4-flash`.

`scaffold --dump` is the only path that requires neither env var, since it never invokes a model.

## How it wires to core

The default dependency factory picks an agent factory based on the command:

- `baseline` → `createBaselineAgent({ ... })`
- `scaffold` → `createScaffoldedAgent({ ... })` (forwarding `systemPrompt` when provided)

Both paths use core's default middleware guardrails: OpenAI moderation safety and markdown-backed
task-scope policy from `packages/core/guardrails/`.

It always builds a `modelRuntime` from `LLM_BASE_URL` + `LLM_API_KEY` with a single connection and passes that, applying the optional `--model` (default `deepseek-v4-flash`). The agent's `messages` array is seeded with a single user message containing the joined prompt.

The response is reduced from the agent's `messages` by walking the list in reverse and returning the first message that yields text. Content is accepted as:

- a plain `string`, or
- an array of blocks where each block is a `string` or an object with a string `text` field (multi-block text is joined with `\n`).

If `messages` is not an array the CLI exits `1` with `Core returned no messages.` If no text can be extracted, it exits `1` with `Core returned no text response.`

## `scaffold --dump` output

Invokes `createRuntimeScaffold()` (honoring `--system-prompt` / `--system-prompt-file` when given) and prints a stable JSON projection of it. The shape is:

```jsonc
{
  "architecture": "supervisor-specialists",
  "virtualFilesystem": { "scratch": "/scratch", "plans": "/plans", /* ... */ },
  "memoryFilePaths": [ /* ... */ ],
  "memory": { /* ... */ },
  "interruptOn": [ /* ... */ ],
  "permissions": { /* ... */ },
  "clarification": { "requiredSubagent": "clarifier", /* ... */ },
  "systemPrompt": "...",
  "subagents": [
    {
      "name": "clarifier",
      "description": "...",
      "systemPrompt": "...",
      "interruptOn": [ /* ... */ ],
      "tools": [ /* ... */ ],
      "skills": [ /* ... */ ],
      "hasResponseFormat": true,   // boolean projection of responseFormat
      "hasModel": false            // boolean projection of model
    }
    // ... researcher, analyst, review-agent
  ]
}
```

`tools`, `skills`, and the subagent prompts are passed through verbatim; `responseFormat` and `model` are collapsed to `hasResponseFormat` / `hasModel` booleans so the dump stays inspectable without serializing functions or large model descriptors.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success, `--help`, `--version`, REPL completion, or `scaffold --dump`. Output is written to **stdout**. |
| `1` | Missing/unknown command, unknown flag, missing credentials, conflicting flags, or a runtime error from core. Output is written to **stderr**. |

The entrypoint sets `process.exitCode` rather than calling `process.exit()`, so pending I/O (e.g. background trace submission) is not truncated.

## Programmatic API

`runCli` is exported so the same code path can be driven from tests or a host process without spawning a subprocess. All side-effectful collaborators are passed through a `CliDependencies` seam:

```ts
import { runCli } from "@deep-agent-template/cli";

const { exitCode, output } = await runCli(
  ["scaffold", "--model", "deepseek-v4-flash", "Hello"],
  {
    createAgent: ({ apiKey, baseURL, model, runtime, systemPrompt }) => ({
      async invoke({ messages }) {
        // ...call core or a test double
        return { messages: [{ content: "Hi" }] };
      },
    }),
    createScaffold: (options) => createRuntimeScaffold(options),
    getOpenAICompatibleEndpoint: () =>
      process.env.LLM_BASE_URL
        ? { apiKey: process.env.LLM_API_KEY ?? "", baseURL: process.env.LLM_BASE_URL }
        : undefined,
    // Optional overrides for the REPL:
    createLineReader: () => myAsyncIterable,
    print: (text) => console.log(text),
  },
);
```

The `CliDependencies` shape:

| Field | Required | Purpose |
| --- | --- | --- |
| `createAgent(options)` | yes | Builds the agent (`runtime: "baseline" \| "scaffolded"`) and returns something with an `invoke({ messages })` method. Receives `apiKey`, `baseURL`, optional `model`, `runtime`, and optional `systemPrompt`. |
| `createScaffold(options?)` | yes | Builds the `RuntimeScaffold` used by `scaffold --dump`. |
| `getOpenAICompatibleEndpoint?` | yes | Returns `{ apiKey, baseURL }` for the OpenAI-compatible endpoint. Both fields are required to run an agent; `scaffold --dump` does not call it. |
| `createLineReader?` | no | Returns an `AsyncIterable<string>` of input lines for the REPL. Defaults to a `readline` interface on stdin/stdout. |
| `print?` | no | Sink for REPL output and prompts. Defaults to `console.log`. |

Omitting the second argument uses `defaultDependencies`, which reads `LLM_BASE_URL`/`LLM_API_KEY` from `process.env` and builds the real baseline or scaffolded agent via core.

## Tests

```sh
bun test
```

`src/index.test.ts` exercises the full surface through the dependency seam: help/version output, the `baseline` and `scaffold` commands, prompt and model parsing, inline and file-based system-prompt overrides (and their mutual-exclusion rule), the OpenAI-compatible endpoint path, missing-credential handling, `scaffold --dump` (including its JSON shape and `--system-prompt` passthrough), scaffold-only-flag rejection on `baseline`, the `--dump`-with-prompt conflict, missing/unknown commands, runtime-failure propagation, structured (array-of-blocks) content extraction, and the stateless REPL (blank-line skipping, `/quit`/`/exit`/EOF, per-turn error isolation). No live model calls are made.
