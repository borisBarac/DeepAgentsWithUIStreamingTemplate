# Deep Agent Template

## Intended Usage
- Template to speed up development of multi agents systems
- Should be forked and used as starting point of the new project

## Features in development
- Support to use ImageGeneration in the GeneratedUI elements (example product cart with an image of product)

## Description

Multi-user web app built on a controlplane/worker architecture (Next.js API + BullMQ workers, Redis seam). Ships a pre-configured DeepAgent with specialist subagents:

- **clarifier** — structured intake with bounded clarification rounds
- **researcher** — web scraping, research, Python sandbox execution
- **analyst** — data analysis with Python sandbox
- **review-agent** — quality review and feedback
- **product-generator** — product concept creation
- **image-designer** — product image generation

[View the web app screenshot](IMG/web-app.jpg)

Product requests create or update reviewed product batches. Casual messages go to a small conversational agent and do not start the product workflow.

## Capabilities

- **Supervisor-specialist architecture** — one-call factory (`createScaffoldedAgent()`), configurable tool bundles per role, optional `general-purpose` fallback
- **3-tier model runtime** — fast/normal/pro tiers, any OpenAI-compatible endpoint, lazy model caching
- **Clarification-first intake** — structured questions, bounded rounds (2×3), auto-proceeds with assumptions
- **Guardrails** — content safety + task scope classification (fast-tier), markdown policy files, casual-message gate
- **Generative UI (A2UI)** — model-authored UI via NDJSON stream, catalog-validated, dual validation (Ajv + mini-validator), 128 KiB limit
- **Workflow controller** — 8-phase state machine, deterministic UI emission, bounded retries
- **Interaction stream** — NDJSON (`message`, `ui`, `question`, activity, `error`), auto-repair, context stripping
- **Durable memory** — virtual filesystem, pluggable backends (Redis, FS, S3, in-memory), content review
- **Python sandbox** — Docker-isolated `execute_python`, strict containment, pluggable backend interface
- **Image generation** — pluggable providers (Replicate or stub), wired to `image-designer`
- **Web scraping** — Linkloom MCP (scrape, markdown, PDF, search), wired to `researcher`
- **Observability** — OpenTelemetry system traces/metrics + LangSmith agent tracing with per-subagent queries

## Architecture

```
User request → product/casual gate → guardrails → clarification
  → execution → product generation → review → revision or delivery
```

Workflow phases: `clarification` → `waiting_for_user` → `execution` → `product_generation` → `review` → `revision` → `delivery_ready` (plus `error`). The controller also limits clarification rounds, review cycles, and retries.

### API / Worker split

The web app runs as two process types: the **API** (Next.js) and one or more **workers**. **Redis** is the seam between them — the API never calls an LLM; it enqueues a BullMQ job and tail-reads a per-session Redis Stream. Workers run agent turns and publish UI events back through the stream. Sessions, runs, locks, cancellation flags, and durable memory all live in Redis, namespaced by `sha256(tenantId \0 userId \0 sessionId)` so concurrent guests never collide.

- **Workflow flowchart & data flow diagram**: [`docs/diagram.md`](docs/diagram.md)
- **Isolation layers, scaling knobs & timing constants**: [`docs/worker-architecture.md`](docs/worker-architecture.md)

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
- **Coordination**: Redis (sessions, runs, streams, locks, memory) + BullMQ (job queue)
- **Generative UI**: catalogue-validated flat A2UI adapted to `@json-render/core` at the renderer boundary
- **Validation**: Ajv 2020-12 (server), mini-validator (browser), Zod 4
- **Web Scraping**: `@boris.barac/linkloom` 0.2.1 MCP server (streamable-HTTP, dedicated container)
- **Image Gen**: Replicate SDK
- **Sandbox**: Docker (`python:3.12-slim`, strict isolation)
- **Observability**: OpenTelemetry system tracing and metrics, plus LangSmith agent tracing

## Quick Start, Env Vars, Scripts & CLI

See [`docs/getting-started.md`](docs/getting-started.md) for setup, environment variables, available scripts, and agent CLI usage.

## Documentation

| Path | Description |
|---|---|
| [`docs/getting-started.md`](docs/getting-started.md) | Quick start, env vars, scripts, agent CLI |
| `packages/core/README.md` | Full API reference: scaffolding, models, memory, prompts, guardrails, tools, sandbox, LangSmith |
| `docs/worker-architecture.md` | API/worker split, Redis seam, isolation layers, scaling knobs |
| `docs/memory-setup.md` | Durable memory backends (Redis default, S3) |
| `docs/sandbox.md` | Python sandbox usage and MCP wiring |
| `docs/diagram.md` | Mermaid flowchart of the supervisor workflow |
| `docs/agent-cli.md` | CLI usage, options, REPL commands |
| `docs/ui-catalogue.md` | UI component catalogue, wire format, validation, adding components |
| `docs/image-generation.md` | Image generation providers and agent wiring |
| `packages/sandbox/README.md` | Sandbox backend design and "writing a new backend" checklist |
| `CONTEXT.md` | Domain vocabulary |
| `AGENTS.md` | Issue tracker config and quality gates |

## License

MIT
