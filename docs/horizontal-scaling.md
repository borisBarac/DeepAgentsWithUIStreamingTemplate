# Horizontal scaling: Redis + BullMQ

The web app uses one execution backend in production and local development: Redis + BullMQ workers. The API is stateless. Session state, agent memory, workflow state, run state, locks, cancellation flags, and streamed events all live in Redis. POST `/api/agent` relays worker events through Redis Streams.

This document is the single source of truth for the stateless backend. Read it before assuming anything about durability, concurrency, or shutdown behavior.

## Architecture

```
                   ┌─────────────────┐
   POST /api/agent │   API process   │
   ───────────────▶│  (Next.js)      │
                   │  - stateless    │
                   │  - 409 on busy  │
                   └────────┬────────┘
                            │
                       Redis (shared)
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
         sessions     BullMQ queue    event streams
       run state      agent-turn      (one per run)
       locks          ┌───────────────┐
       cancel flags   │ Worker process│
       memory         │ - runs turns  │
       workflow       │ - owns sandbox│
                       └───────────────┘
```

- The API **acquires a per-session lock**, enqueues a BullMQ job (jobId = runId, so duplicate enqueues are idempotent), and projects the `AgentExecutionHandle` from the run's Redis Stream.
- The worker **consumes the job**, runs the turn through the shared `TurnRunner`, persists UI events + terminal result to the run's Redis Stream, commits session/memory/workflow state to Redis, and releases the lock.
- The API's POST handler **XREADs the stream and relays UI events as NDJSON** to the client. Terminal events close the HTTP stream.

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` locally | Required Redis connection URL. |
| `REDIS_KEY_PREFIX` | `dat:` | Namespaces this deployment's keys in a shared Redis. |
| `WORKER_CONCURRENCY` | `5` | BullMQ Worker concurrency (jobs in parallel per worker process). |
| `WEB_APP_SANDBOX_CPUS` | `2.5` | Per-worker Docker sandbox CPU budget. |
| `WEB_APP_SANDBOX_MEMORY` | `1280m` | Per-worker Docker sandbox memory budget. |

Required LLM/model variables (see `.env.example`) are the same for both backends.

## Running locally

```bash
# 1. Start Redis + API + worker (production-shaped):
docker compose --env-file .env -f infra/docker-compose.yml up --build

# 2. Or run API + worker separately with a local Redis:
REDIS_URL=redis://localhost:6379 bun run web-app   # API
REDIS_URL=redis://localhost:6379 bun run worker     # worker
```

Without `REDIS_URL`, the API and worker fail closed. Inline execution is test-only.

## Local worker (foreground debugging)

`bun run worker:local` runs the BullMQ worker in the foreground against the Docker Redis, with the rest of the stack still in Docker. It forces `REDIS_URL=redis://localhost:6379` and `WORKER_CONCURRENCY=1` (everything else comes from the root `.env`). This is the loop to use when you want worker logs inline, breakpoints via `console.log`, or fast rebuilds without rebuilding the Docker image.

The API (inside Docker) reaches Redis at `redis://redis:6379` — the Docker-internal hostname of the `redis` service. The host-side worker reaches the **same** Redis instance at `redis://localhost:6379`, because `infra/docker-compose.yml` publishes `6379:6379`. Both URLs resolve to one Redis; BullMQ jobs enqueued by the API are visible to either worker.

### Start the local worker

```bash
# 1. Stop the Docker worker so it does not compete for jobs.
docker compose --env-file .env -f infra/docker-compose.yml stop worker

# 2. Bring up Redis + the API (rebuild if the image changed).
docker compose --env-file .env -f infra/docker-compose.yml up --detach --build redis api

# 3. Run the worker on your host.
bun run worker:local
# → [worker] consuming agent-turn jobs (concurrency=1)
```

Submit an agent request through the API (`bun run agent-cli "..."` or the web UI). Only the local worker should pick it up — its logs will show the turn.

### Restore the Docker worker

```bash
# 1. Stop the local worker.
Ctrl+C

# 2. Restart the Docker worker.
docker compose --env-file .env -f infra/docker-compose.yml up --detach worker
```

### Do not run both workers at once

BullMQ distributes `agent-turn` jobs across every connected worker. If both the Docker worker and the local worker are running, jobs will land on whichever worker wins the queue — making logs, breakpoints, and reproduction nondeterministic. Always `docker compose --env-file .env -f infra/docker-compose.yml stop worker` before starting the local worker.

## TTLs (defaults)

TTLs are documented in `packages/web-app/src/server/redis/keys.ts:DEFAULT_TTL_SECONDS` and can be overridden per-store in production wiring (not yet exposed as env vars — file an issue if you need that).

| Keyspace | Default | Rationale |
|---|---|---|
| `session:*`, `session:ver:*`, `session:runmeta:*` | 7 days | Long enough for a guest to come back across restarts. |
| `run:state:*`, `stream:*`, `cancel:*` | 1 hour | Long enough for the API to read final state after a worker finishes; bounded so abandoned runs disappear. |
| `workflow:*` | 7 days | Match session lifetime. |
| `memory:item:*`, `memory:idx:*` | 7 days | Match filesystem memory store TTL. |
| `lock:*` (session lock lease) | 30 seconds | Refreshed by the worker at ~1/3 of the lease; lost workers free up quickly. |

## Session ownership + cancellation

- Before enqueueing, the API **atomically acquires a Redis lock** for the full `(tenant, user, session)` key.
- A second concurrent turn for the same session returns **HTTP 409** with `{ error, activeRunId }` and is never enqueued.
- The lock carries a **fencing token** (monotonic per lock key). The worker reads the lock back to recover the token; on commit, the token in the lock record must match the worker's.
- The worker **refreshes the lease** while the turn runs. If the refresh fails (lease expired, Redis restarted, another worker took over), the worker stops publishing — its next commit would fail the fencing check anyway.
- On client disconnect, the API sets a **per-run cancellation flag** in Redis. The worker polls between streamed events and aborts the active interaction. Cancelled runs preserve the previously committed session state.

## BullMQ semantics

- Jobs are added with `attempts: 1` (one execution, zero retries) and `jobId: runId` (duplicate enqueues are no-ops).
- `removeOnComplete: true` and `removeOnFail: true` keep the BullMQ keyspace bounded.
- The BullMQ Worker reads from a dedicated Redis connection (`maxRetriesPerRequest: null`) because BullMQ issues blocking reads. The shared store client (`maxRetriesPerRequest: 3`) is a separate connection.

## Shutdown

- **API**: Next.js handles SIGTERM. Open POST streams are cancelled; clients see a TCP reset. The shared Redis client quits cleanly via `closeRedisClients()` on process exit.
- **Worker** (`packages/web-app/scripts/worker.ts`): handles `SIGINT`/`SIGTERM`/`uncaughtException`/`unhandledRejection`. The shutdown sequence closes the BullMQ Worker, disposes the Docker sandbox backend, quits the Redis clients, and flushes telemetry. In-flight turns get a terminal error event so the API's stream reader does not hang.

## Health checks

`GET /api/health` — liveness probe. Always 200 if the process is responsive.

`HEAD /api/health` — readiness probe. 200 only when Redis is reachable (when configured). Load balancers should route traffic away from instances returning non-200.

Workers do not expose HTTP. Process-level health (docker/k8s) covers worker liveness; the BullMQ Worker emits `error` events that the worker script logs and shuts down on.

## What is NOT in scope

- **Distributed rate limits / tenant quotas.** The gateway is responsible.
- **Distributed usage limits.** Out of scope.
- **Redis Cluster / Sentinel.** Single Redis endpoint is assumed. BullMQ + ioredis support Cluster, but the wiring here is single-node.

## Testing

- **Inline backend.** Covered by the existing `route.test.ts` and `request-runner.test.ts` suites.
- **Redis backend (offline).** All Redis-backed stores + the BullMQ executor + the worker's `runWorkerJob` are unit-tested against a minimal in-memory fake (`packages/web-app/src/server/redis/fake-redis.ts`). 83 tests in `packages/web-app/src/server/redis/` and `packages/web-app/src/server/worker/`.
- **Worker round-trip e2e (opt-in).** `packages/web-app/e2e/worker-roundtrip.e2e.test.ts` exercises the real distributed path end-to-end: a testcontainer Redis, an in-process BullMQ Worker (`createAgentWorker`), and a `BullMqAgentExecutor` submitting turns and projecting the result handle back over the Redis stream. Covers happy-path cancellation (abort → `cancelled`) and session-busy 409 with no LLM cost (a hanging fake agent); the full product-workflow happy path runs when `RUN_LIVE_E2E=1` + LLM credentials are present. Run with `bun run --filter @deep-agent-template/web-app test:e2e`. Note: because the executor and worker run in one process, the harness gives each a dedicated ioredis connection — the executor's blocking stream reads would otherwise starve the worker's commands on a shared connection (production avoids this by running them in separate processes).
- **Live Redis (full stack).** Not part of the required offline gates. Use `docker compose --env-file .env -f infra/docker-compose.yml up` to smoke-test the whole topology (api + worker + redis + linkloom) locally.

## Follow-ups tracked in beads

- `DeepAgentTemplate-e7jy` — Remote executor + durable SessionStore (Redis/BullMQ) behind the AgentExecutor seam (this work).
- `DeepAgentTemplate-ykgj` — Durable session store for guest continuity (storage backend, reconciled with this work).
- `DeepAgentTemplate-atro` — Reconcile commit-on-failure semantics + hard-cancel of in-flight agent run.
