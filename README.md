# Deep Agent Template

Build an AI product with a working agent workflow, rendered product UI, and local development setup.

Deep Agent Template provides a supervisor, specialist subagents, clarification, guardrails, durable memory, a Python sandbox, image generation, and a Next.js workspace. The default workflow creates and reviews product concepts, then renders them in the web app.

Deep Agent Template gives you:

- `createScaffoldedAgent()` with a supervisor, clarifier, researcher, analyst, reviewer, product-generator, and optional image-designer.
- A workflow controller that owns clarification, execution, product generation, review, revision, delivery, and errors.
- A validated A2UI catalogue, an NDJSON interaction stream, durable memory, LangSmith tracing, and a Docker Python sandbox.
- A Next.js workspace with chat, preview, and activity panes.

Product requests create or update reviewed product batches. Casual messages go to a small conversational agent and do not start the product workflow.

## Architecture

```
User request → product/casual gate → guardrails → clarification
  → execution → product generation → review → revision or delivery
```

Workflow phases: `clarification` → `waiting_for_user` → `execution` → `product_generation` → `review` → `revision` → `delivery_ready` (plus `error`). The controller also limits clarification rounds, review cycles, and retries.

### Monorepo (4 packages)

| Package | Purpose |
|---|---|
| `packages/core` | Agent framework, scaffolding, all AI logic |
| `packages/web-app` | Next.js 16 frontend + API route |
| `packages/sandbox` | Docker-based Python execution sandbox |
| `packages/image-gen` | Image generation (Replicate + stub provider) |

## Tech Stack

- **Runtime**: Bun 1.3.14
- **Language**: TypeScript 5.9 (strict, ES2023)
- **AI Framework**: `deepagents` (supervisor-specialist agent library)
- **LLM**: LangChain + OpenAI-compatible endpoints (DeepSeek, OpenAI, Ollama, vLLM)
- **Web**: Next.js 16 (App Router), React 19
- **Generative UI**: catalogue-validated flat A2UI adapted to `@json-render/core` at the renderer boundary
- **Validation**: Ajv 2020-12 (server), mini-validator (browser), Zod 4
- **Web Scraping**: `@boris.barac/linkloom` MCP server (Camoufox browser)
- **Image Gen**: Replicate SDK
- **Sandbox**: Docker (`python:3.12-slim`, strict isolation)
- **Observability**: LangSmith tracing
- **Linting**: Biome 2.5
- **Testing**: Bun test runner
- **Storybook**: 10.5

## Capabilities

### Supervisor-Specialist Agent Architecture
- One-call factory (`createScaffoldedAgent()`) producing a fully wired multi-agent system
- Specialist roles: `clarifier`, `researcher`, `analyst`, `review-agent`, `product-generator`, `image-designer`
- `general-purpose` fallback subagent (disabled by default)
- Named specialist delegation with configurable tool bundles per role

### 3-Tier Model Runtime
- **fast**: clarifier, guardrail classifiers (cheap/low-latency)
- **normal**: researcher, image-designer, coder
- **pro**: supervisor, analyst, reviewer, finalizer (heavy reasoning)
- Works with any OpenAI-compatible endpoint
- Lazy model caching per category, configurable via env vars or programmatic config

### Clarification-First Intake
- Every request enters clarification phase before execution
- Structured questions with optional multiple-choice options and recommended answers
- Bounded rounds (default 2) and questions per round (default 3)
- Auto-proceeds with stated assumptions when round cap is reached

### Guardrails (Preflight Safety)
- **ContentSafetyGuardrail**: classifies user input for unsafe content
- **TaskScopeGuardrail**: structured in-scope vs out-of-scope classification
- Policy controlled by markdown files (`allowedTasks.md`, `disallowedTasks.md`, `requiredContext.md`)
- Uses fast-tier model for classification
- Casual messages use a separate scoped assistant and do not enter product execution

### Generative UI (A2UI) System
- Model-authored UI uses flat A2UI updates in the NDJSON interaction stream
- Components: `Button`, `Card`, `ImagePlaceholder`, `ProductCard`, `ProductGrid`, `Stack`, `Text`, `TextInput`
- `catalog.json` is the single source of truth for schemas and limits
- Dual validation: Ajv (server) + mini-validator (browser)
- Invalid model-authored UI gets one retry with structured validation feedback
- Strict 128 KiB payload limit, max 100 components per update

### Workflow Controller (State Machine)
- State machine (8 phases including `error`) driving the agent lifecycle
- Deterministic UI emission for clarification questions and reviewed product batches
- Product updates replace the current product grid while preserving the approved count
- Max clarification rounds, max review cycles, controller retry limits

### Interaction Stream
- NDJSON streaming: `message`, `ui`, `question`, `main_agent_activity`, `subagent_activity`, `error`
- Controller feedback stays in workflow state and is shown in activity updates, not as a chat message
- Auto-repair for invalid model-authored UI output (one retry with feedback)
- Chat history management with transient context stripping

### Memory System (Single-User Durable Storage)
- Virtual filesystem: `/memory`, `/scratch`, `/plans`, `/reports`, `/artifacts`, `/skills`
- Durable: `/memory/project-facts.md`, `/memory/user-preferences.md`
- Pluggable backends: `FileSystemMemoryStore`, `InMemoryMemoryStore`, `BucketMemoryStore`
- Content review: flags credentials, inferred preferences, transient details
- Auto-approved writes for single-user namespace

### Python Sandbox (Docker)
- `execute_python` tool for researcher and analyst subagents
- Strict isolation: no network, `cap_drop: ALL`, read-only FS, `nobody` user
- Configurable resource profiles (small/medium/large)
- Pluggable `SandboxBackend` interface (Docker, E2B, Daytona, Vercel, etc.)

### Image Generation
- Pluggable providers: Replicate (real) or fixed stub (default, no API key needed)
- `generate_image` tool wired to `image-designer` subagent

### Web Scraping (Linkloom MCP)
- Camoufox browser via MCP server
- Tools: `scrape`, `html_to_markdown`, `pdf_to_markdown`, `render_page`, `extract_links`, `extract_tables`
- Wired exclusively to the `researcher` subagent

### LangSmith Observability
- Full tracing of model calls, tool invocations, agent runs
- Per-subagent metadata for querying traces
- Query helpers: `listRunsBySubagent()`, `listTracesBySubagent()`

### Prompt System
- All prompts in Markdown files under `packages/core/prompts/`
- Typed `PromptLoader` extension point for custom sources
- Per-role prompts + bundled skills (`clarify-deeply`)
- `SOUL.md` core identity + `FILESYSTEM_CONTRACT` appended to all agents

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL

# 3. Run the web app
bun run web-app
# → http://localhost:3000

# 4. Run the CLI (requires web app running)
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

### Optional model tiers

| Variable | Default | Roles |
|---|---|---|
| `FAST_MODEL` | falls back to `LLM_MODEL` | clarifier, guardrail classifier |
| `PRO_MODEL` | falls back to `LLM_MODEL` | supervisor, analyst, reviewer, finalizer |

### Optional features

| Variable | Description |
|---|---|
| `LANGSMITH_TRACING` | `true` to enable LangSmith tracing |
| `LANGSMITH_API_KEY` | LangSmith API key |
| `LANGSMITH_PROJECT` | LangSmith project name |
| `LANGSMITH_ENDPOINT` | Non-US region endpoint |
| `USE_FAKE_IMAGE_PROVIDER` | `true` (default) for stub, `false` for Replicate |
| `REPLICATE_API_TOKEN` | Required when using real image generation |
| `WEB_APP_MEMORY_DIR` | Persistent memory path (defaults to `packages/web-app/.data/memory`) |

## Scripts

```bash
bun test                              # Unit tests (all packages)
bun run typecheck                     # TypeScript type checking
bun run check                         # Biome lint + format
bun run --filter @deep-agent-template/web-app build   # Next.js build
bun run web-app                        # Start web dev server
bun run agent-cli                      # CLI client
bun run storybook                      # Storybook (port 6006)
bun run smoke:langsmith                # Verify LangSmith tracing
```

### Live E2E tests (opt-in, requires LLM credentials)

```bash
bun run --filter @deep-agent-template/core test:e2e
```

## Documentation

| Path | Description |
|---|---|
| `packages/core/README.md` | Full API reference: scaffolding, models, memory, prompts, guardrails, tools, sandbox, LangSmith |
| `docs/diagram.md` | Mermaid flowchart of the supervisor workflow |
| `docs/agent-cli.md` | CLI usage, options, REPL commands |
| `docs/ui-catalogue.md` | UI component catalogue, wire format, validation, adding components |
| `docs/codex-cloud.md` | OpenAI Codex Cloud environment setup |
| `packages/sandbox/README.md` | Sandbox backend design and "writing a new backend" checklist |
| `CONTEXT.md` | Domain vocabulary |
| `AGENTS.md` | Issue tracker config and quality gates |

## Web App

Single-page agent workspace at `/`:

- **Chat pane**: message list, prompt starters, text composer, clarification question controls
- **Preview pane**: renders generated UI specs via `@json-render/react`
- **Debug pane**: real-time agent/subagent activity log

API endpoint: `POST /api/agent` (NDJSON streaming)

## Agent CLI

```bash
bun run agent-cli "Your message"          # One-shot
bun run agent-cli --ndjson "Your message" # Machine-readable
bun run agent-cli --file prompt.txt        # From file
bun run agent-cli --repl                  # Interactive REPL
```

REPL commands: `:reset`, `:session`, `:activity`, `:raw`, `:history`, `:specs`, `:format`, `:help`

## License

Private
