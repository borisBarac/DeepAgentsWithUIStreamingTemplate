## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
# Set REDIS_URL (required for the API/worker split and durable memory)
# Set GUEST_IDENTITY_SECRET (HMAC secret for the guest session cookie)
# Optionally set SANDBOX_MCP_URL to enable the execute_python tool

# 3. Start Redis and the Sandbox MCP service
docker compose -f infra/docker-compose.yml up -d redis sandbox-mcp

# 4. Run the web app + worker together (recommended for local dev)
bun run dev
# → http://localhost:3000
# (Or run them separately: `bun run web-app` and `bun run worker`)

# 5. Run the CLI (requires the web app running)
bun run agent-cli "Design a product card for a hiking backpack"
bun run agent-cli --repl    # Interactive mode
```

## Environment Variables

### Required (live agent calls)

| Variable | Description |
|---|---|
| `LLM_BASE_URL` | OpenAI-compatible endpoint (e.g. `https://api.deepseek.com`) |
| `LLM_API_KEY` | API key |
| `LLM_MODEL` | Normal-tier model (default for all roles) |
| `REDIS_URL` | Redis for sessions, runs, streams, locks, and durable memory |
| `GUEST_IDENTITY_SECRET` | HMAC secret for the session-only `guest_identity` cookie |

### Optional model tiers

| Variable | Default | Roles |
|---|---|---|
| `FAST_MODEL` | falls back to `LLM_MODEL` | clarifier, guardrail classifier |
| `PRO_MODEL` | falls back to `LLM_MODEL` | supervisor, analyst, reviewer, finalizer |

### Optional features

| Variable | Description |
|---|---|
| `SANDBOX_MCP_URL` | Sandbox MCP service URL (enables `execute_python`); default `http://localhost:3010/mcp` |
| `WORKER_CONCURRENCY` | BullMQ jobs per worker process (default `5`) |
| `WORKER_MAX_QUEUE_WAIT_MS` | Drop stale jobs after this queue wait (default `60000`) |
| `NEXT_PUBLIC_AGENT_DEBUG` | Agent activity panel + cancel-on-disconnect (default `true`) |
| `LANGSMITH_TRACING` | `true` to enable LangSmith tracing |
| `LANGSMITH_API_KEY` | LangSmith API key |
| `LANGSMITH_PROJECT` | LangSmith project name |
| `LANGSMITH_ENDPOINT` | Non-US region endpoint |
| `USE_FAKE_IMAGE_PROVIDER` | `true` (default) for stub, `false` for Replicate |
| `REPLICATE_API_TOKEN` | Required when using real image generation |

## Scripts

```bash
bun test                              # Unit tests (all packages)
bun run typecheck                     # TypeScript type checking
bun run check                         # Biome lint + format
bun run --filter @deep-agent-template/web-app build   # Next.js build
bun run dev                           # Start web app + worker together
bun run web-app                       # Start web dev server only
bun run worker                        # Start a worker process
bun run agent-cli                     # CLI client
bun run storybook                     # Storybook (port 6006)
bun run smoke:langsmith                # Verify LangSmith tracing
```

### Live E2E tests (opt-in, requires LLM credentials)

```bash
bun run --filter @deep-agent-template/core test:e2e
```

## Agent CLI for use with agents

```bash
bun run agent-cli "Your message"          # One-shot
bun run agent-cli --ndjson "Your message" # Machine-readable
bun run agent-cli --file prompt.txt        # From file
bun run agent-cli --repl                  # Interactive REPL
```

REPL commands: `:reset`, `:session`, `:activity`, `:raw`, `:history`, `:specs`, `:format`, `:help`
