# Agent CLI

HTTP client for the `/api/agent` endpoint. Mirrors the website UI's NDJSON streaming and schema validation.

## Quick start

```bash
# One-shot message (pretty output, auto-detected for TTY)
bun run agent-cli "Create a product card for a hiking backpack"

# Machine-readable NDJSON
bun run agent-cli --ndjson "Create a product card for a hiking backpack"

# Pipe a file
bun run agent-cli --file prompt.txt

# Interactive multi-turn REPL
bun run agent-cli --repl
```

The dev server must be running (`bun run web-app` or `bun run --filter @deep-agent-template/web-app dev`). Defaults to `http://localhost:3000`.

## Options

| Flag | Description |
|---|---|
| `--base-url <url>` | Server base URL (default `http://localhost:3000`) |
| `--session <id>` | Session id (default: fresh UUID) |
| `--include-activity` | Stream main/subagent activity (default on) |
| `--no-include-activity` | Disable activity streaming |
| `--pretty` | Force human-readable output |
| `--ndjson` | Force one JSON object per line |
| `--quiet` | Only print the final assistant message |
| `--show-structured` | Print the final `structuredOutput` JSON |
| `--show-history` | Print the committed chat history JSON |
| `--fail-on-error` | Exit non-zero if an error update arrives |
| `--repl` | Interactive REPL mode |
| `--file <path>` | Send file contents as the message |
| `--help` | Show help |

### Environment variables

| Variable | Equivalent flag |
|---|---|
| `AGENT_CLI_BASE_URL` | `--base-url` |
| `AGENT_CLI_SESSION` | `--session` |

## REPL commands

Inside `--repl` mode:

| Command | Description |
|---|---|
| `:help` | Show REPL commands |
| `:reset` | New session |
| `:session` | Show current session id |
| `:activity` | Show accumulated activity log |
| `:raw` | Toggle raw NDJSON output |
| `:history` | Show committed chat history |
| `:specs` | Show accumulated UI specs |
| `:format pretty/ndjson` | Switch output format |
| `:base-url <url>` | Change server URL |

When the agent asks a clarification question, the REPL prompts for answers. On completion the answers are batched into the next message automatically.

## Output modes

- **Auto** (default): pretty if TTY, NDJSON if piped
- **Pretty**: human-readable activity + messages
- **NDJSON**: one JSON object per line (each streamed update). Useful for scripting:

```bash
bun run agent-cli --ndjson "Create a product" | jq 'select(.type == "ui")'
```
