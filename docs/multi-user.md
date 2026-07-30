# Multi-user model: anonymous guests

The web app supports many concurrent users. Every user is an **anonymous guest**. There is no authentication, no user database, no tenant provisioning, and no rate limiting inside the app.

This document is the single source of truth for what that model means in practice. Read it before assuming anything about identity, isolation, or persistence.

## Identity

- Each browser gets a UUID v4, minted client-side by `packages/web-app/src/ui/guest-id.ts` and persisted in `localStorage` plus a `SameSite=Lax` cookie (1-year `Max-Age`).
- The UUID is sent on every request via the `x-guest-id` header.
- The server (`packages/web-app/src/server/identity.ts`) validates the UUID v4 format and pins `tenantId = "guests"`. Any well-formed UUID v4 is accepted; there is no lookup.
- Requests missing or malformed `x-guest-id` are rejected with HTTP 400. The client (`getOrCreateGuestId`) always validates before sending, so this should be unreachable in normal operation — but a reverse proxy that strips custom headers will surface it as a generic `Request failed with status 400.` from `useAgentChat`. There is no automatic retry; the user must reload the page.
- The CLI (`packages/web-app/src/cli/http-client.ts`) mints a fresh UUID per process invocation unless the caller supplies one.

## Trust boundary

There is no security boundary between guests beyond the UUID. A guest who knows another guest's UUID can impersonate them. This is acceptable for the template's intended deployments (anonymous public access). If you need real authentication or non-repudiation, this is the boundary you must replace.

The UUID is filesystem-safe and matches the memory namespace encoder's raw-id pattern, so it flows through `createUserMemoryNamespace` without base64 encoding. `assertSafeNamespace` still rejects path-traversal attempts.

## What is isolated per guest

- **Conversation history (session state).** Keyed by `(tenantId, userId, sessionId)` in `InMemorySessionStore`. Two guests using the same `sessionId` never collide. See `packages/web-app/src/server/agent-runtime/store.ts` for the volatility contract.
- **Memory tree.** Namespaced inside the shared in-memory store under `["users", "<uuid>", "memory"]`. See `docs/memory-setup.md`.
- **LangGraph thread id.** Derived as a truncated SHA-256 over `tenant\0user\0session` so workflow state is collision-proof across guests. See `packages/web-app/src/server/agent-runtime/thread-key.ts`.
- **Trace span attributes.** `tenant.id` and `user.id` are stamped on agent / sandbox spans so traces are attributable per guest.

## What is shared

- **Sandbox.** One Docker sandbox backend per process. Code execution is ephemeral and runs as the same `nobody` user with a shared workspace root. Guests cannot persist files or processes between turns. See `packages/sandbox/README.md`.
- **Model runtime, image generation, model API keys.** Process-wide singletons — every guest uses the same configured provider.

## What is NOT done here

- **Rate limiting.** The gateway is responsible. There is no per-guest or per-IP limit in the web app.
- **Authentication.** By design. To add it, replace `resolveGuestIdentity` with a lookup against your auth system and keep the rest of the agent-runtime plumbing.

## What is volatile (lost on restart)

- **Cached agents.** Still process-local — the cache is only a rebuild optimization, never authoritative.
- Everything else (sessions, memory, workflow state, run state, locks) lives in Redis and survives API/worker restarts up to the configured TTLs.

## Follow-ups tracked in beads

- `DeepAgentTemplate-e7jy` — Remote executor + durable SessionStore (Redis/BullMQ) behind the AgentExecutor seam (shipped; see `docs/horizontal-scaling.md`).
- `DeepAgentTemplate-58p3` — S3 memory store adapter (durable guest memory beyond Redis TTL).
