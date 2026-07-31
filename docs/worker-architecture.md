# Worker architecture

The web app splits work across two process types: the **API** (Next.js) and one or more **workers**. Redis is the seam between them. The API never calls an LLM — it only enqueues work and tail-reads an event stream. Workers run agent turns and publish UI events back through Redis Streams.

This split lets the system serve many guest users concurrently and scale workers horizontally without changes to the API.

## Request flow

A single agent turn crosses three boundaries: browser → API → Redis → worker → Redis → browser.

```text
Browser ──POST /api/agent──► API
                            │ 1. resolveGuestIdentity (cookie → {tenant:"guest", userId})
                            │ 2. BullMqAgentExecutor.execute:
                            │    • lock.acquire (SET NX EX 90s + INCR fencing token) → 409 if held
                            │    • queue.add("agent-turns", {req, token}, jobId=scopedJobId)
                            │ 3. XREAD BLOCK on dat:stream:<hash> → NDJSON to client
                            ▼
                    ──── Redis (the seam) ────
                            ▼
Worker::runWorkerJob (agent-worker.ts:171)
  • abortExpiredQueuedJob if sat >60s
  • verify currentHolder().runId+token (fencing token pattern)
  • startLeaseRefresh every 5s → self-abort if lost
  • sessionStore.loadSession → turnRunner.start → publishUi events
  • commitSession (CAS on version) → release lock
```

Key points:

- The HTTP response stays open while the API blocks on `XREAD` against the per-session stream. The client renders NDJSON UI events as they arrive and closes on the terminal `result` event.
- If a client disconnects, the run keeps going. `POST /api/agent/reattach` resumes the stream from `afterEventId`.
- `POST /api/agent/cancel` sets a cooperative cancellation flag that the worker polls (every 500ms by default).

## Isolation — three layers, one key

Every piece of per-session state is namespaced by `sha256(tenantId \0 userId \0 sessionId)` (`packages/web-app/src/server/redis/keys.ts:46`). This single hashing scheme drives all three isolation layers:

1. **Keyspace isolation.** Session state, run state, the event stream, the lock, the cancellation flag, and per-user memory all live under distinct hashed keys: `dat:session:state:<hash>`, `dat:stream:<hash>`, `dat:lock:<hash>`, `dat:memory:item:<nsHash>:<keyHash>`, and so on. Two users — or two sessions for the same user — never collide.
2. **Mutual exclusion.** A per-session distributed lock (`SET NX EX 90s`) guarantees only one run per session at a time. A second request for the same session returns HTTP 409 `SessionBusyError`. The lock pairs with a **monotonic fencing token** (`packages/web-app/src/server/redis/session-lock.ts:7-28`) so a stalled worker that recovers after its lease expired cannot clobber a newer run — the classic fencing-token pattern that defeats split-brain.
3. **Agent and memory isolation.** Each worker keeps an LRU cache of 100 built agents keyed on `tenantId\0userId` (`packages/web-app/src/server/agent-provider.ts:126`). The LangGraph thread key is `rt_<hash(tenant\0user\0session)>` (`packages/web-app/src/server/agent-runtime/thread-key.ts:5`), so each session gets its own conversation thread in the checkpointer and each user gets their own memory namespace.

### What "guest" means

The data plane is multi-tenant by design, but the identity plane currently hardcodes `tenantId: "guest"` for everyone (`packages/web-app/src/server/guest-identity.ts:60,67`). Each browser still gets a unique `userId` from the signed `guest_identity` cookie, so the sha256 hashes diverge per user and concurrent guests never interfere. Onboarding real tenants means swapping `resolveGuestIdentity` for a real auth provider that emits `{tenantId, userId}` — everything downstream is already tenant-aware.

### Known gap: the Python sandbox

The agent/memory layer isolates users, but the Python code-execution sandbox is documented as single-user (`packages/sandbox/README.md`). Code-execution isolation between users is **not** enforced at the sandbox layer today.

## Scaling knobs

| Knob | Default | Where |
|---|---|---|
| `WORKER_CONCURRENCY` | `5` | Parallel jobs per worker process (`agent-worker.ts:112`) |
| `WORKER_REPLICAS` | `1` | Worker containers (`infra/docker-compose.yml:142`) |
| `WORKER_MAX_QUEUE_WAIT_MS` | `60000` | Drop stale jobs before execution (`agent-worker.ts:57`) |

Effective parallelism is roughly `WORKER_CONCURRENCY × WORKER_REPLICAS` agent turns in flight at once, subject to per-session locking (one turn per session at a time).

## Built-in timing constants

These are baked into the code rather than env-configurable:

- Lock lease: **90s** (`packages/web-app/src/server/redis/keys.ts:44`)
- Lock refresh interval: **5s** (`packages/web-app/src/server/worker/agent-worker.ts:102`)
- State TTLs (session, run, stream): **1800s** (`packages/web-app/src/server/redis/keys.ts:28`)
- Stream max length: **1000** events (`packages/web-app/src/server/redis/event-stream.ts:6`)
- Cancellation poll interval: **500ms** (`packages/web-app/src/server/redis/cancellation.ts:13`)
- Agent cache cap: **100** per worker process (`packages/web-app/src/server/agent-provider.ts:122`)
