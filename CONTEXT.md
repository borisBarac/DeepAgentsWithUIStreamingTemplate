# Context

## Domain Vocabulary

### Runtime scaffold

The Runtime scaffold is the core module interface that describes the default Deep Agent runtime shape. It owns the supervisor-specialist architecture, virtual filesystem layout, memory paths, backend, interrupts, permissions, subagents, supervisor prompt, and clarification metadata.

Callers use the Runtime scaffold when they need to inspect or override the default runtime shape before creating a scaffolded agent.

### Guardrail decision

The Guardrail decision is the core module interface that resolves the agent's preflight protections. It owns safety and task-scope enablement, task-scope policies, classifier selection, refusal behavior, and middleware ordering.

Callers use the Guardrail decision to inspect the resolved protection state and obtain the final middleware sequence, including caller-provided middleware.

### Redis seam

The Redis instance is the sole coordination layer between the API and the workers. It holds session state, run state, the per-session event stream, the run lock, the cancellation flag, and durable agent memory. Every piece of per-session state is namespaced by `sha256(tenantId \0 userId \0 sessionId)` so concurrent guests never collide. See `docs/worker-architecture.md`.

### BullMQ Agent Executor

The executor runs in the API. On a turn request it acquires a per-session distributed lock (`SET NX EX 90s` with a monotonic fencing token), enqueues a BullMQ job onto the `agent-turns` queue, and then blocks on `XREAD` against the per-session Redis Stream to stream NDJSON UI events back to the client. It never calls an LLM.

### Session stream

A Redis Stream per session (`dat:stream:<hash>`) that carries UI events from the worker back to whichever client is reading. The HTTP response stays open while the API blocks on `XREAD`; a disconnected client resumes via `POST /api/agent/reattach` using `afterEventId`.

### Guest identity

The identity plane currently hardcodes `tenantId: "guest"` for every browser. Each browser still gets a unique `userId` from the signed `guest_identity` cookie (HMAC over `GUEST_IDENTITY_SECRET`), so the sha256 session hash diverges per user and concurrent guests never interfere. Onboarding real tenants means swapping `resolveGuestIdentity` for a real auth provider that emits `{tenantId, userId}` — everything downstream is already tenant-aware.

### RedisMemoryStore

The default durable memory backend for the web app. It implements LangGraph's `BaseStore` contract over the shared Redis client, storing memory items as JSON records under `{REDIS_KEY_PREFIX}memory:*`. Keys are not TTL'd — they persist until explicitly deleted. Replaces the previous filesystem-backed store. See `docs/memory-setup.md`.

### Sandbox MCP

The `execute_python` tool is served by the `@deep-agent-template/sandbox` package as a streamable-HTTP MCP server (`SANDBOX_MCP_URL`). The worker discovers the tool over MCP and injects it into the `researcher` and `analyst` subagents. It is not a built-in core tool. See `docs/sandbox.md`.
