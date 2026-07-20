# Sandbox runtime

Isolated Python execution for the Deep Agent runtime. Docker is one
implementation behind the `SandboxBackend` interface. Agent-facing LangChain
tool definitions remain in `@deep-agent-template/core`.

## Quick start

The scaffolded agent wires `execute_python` to the `researcher` and `analyst`
subagents by default. The auto-added `general-purpose` subagent does **not**
receive `execute_python` — it inherits the supervisor's tools, and the sandbox
tool is scoped to specific subagents only. Pass a custom backend to swap the
implementation:

```ts
import { createScaffoldedAgent } from "@deep-agent-template/core";
import { createDockerSandboxBackend } from "@deep-agent-template/sandbox";

const agent = createScaffoldedAgent({
  pythonSandboxBackend: createDockerSandboxBackend(),
});
```

To wire the tool yourself — for a custom role, or to replace the default
array — build it directly and pass it through `subagentOverrides`:

```ts
import {
  createPythonSandboxTool,
  createScaffoldedAgent,
} from "@deep-agent-template/core";
import { createDockerSandboxBackend } from "@deep-agent-template/sandbox";

const pythonTool = createPythonSandboxTool({
  backend: createDockerSandboxBackend(),
});

const agent = createScaffoldedAgent({
  subagentOverrides: {
    analyst: { tools: [pythonTool] },
  },
});
```

The tool name is `execute_python`, so callers can opt into an
`interruptOn.execute_python` rule when they want approval prompts for Python
execution. The name avoids colliding with the built-in `execute` (shell) tool
reserved by `deepagents`'s `BUILTIN_TOOL_NAMES`.

## Backends

| Backend | Factory | Isolation | Use case |
|---|---|---|---|
| `docker` | `createDockerSandboxBackend()` | container | **Default for untrusted code.** `--network none`, `--cap-drop ALL`, `--read-only` rootfs, non-root user, frozen `python:3.12-slim` image. Pass `containerName` to reuse a long-lived container started by `docker compose up`. |

The backend honors the shared `describeSandboxBackend()` contract (in
`backend-test-harness.ts`), which runs all acceptance cases against it.

## Resource profiles

Named profiles (spec §6, sans GPU) cap CPU, memory, timeout, output size, and
artifact count. Defined in `constants.ts`.

| profile | cpu | mem | max timeout | stdout cap | artifacts |
|---|---|---|---|---|---|
| `sandbox-small` (default) | 0.5 | 256m | 60s | 64 KiB | 1 MiB / 8 files |
| `sandbox-medium` | 1.0 | 512m | 180s | 256 KiB | 8 MiB / 32 files |
| `sandbox-large` | 2.0 | 1g | 300s | 1 MiB | 32 MiB / 64 files |

CPU and memory limits are enforced by the docker backend via cgroups when it
runs a fresh container per execution (`docker run` mode). In `containerName`
mode (reusing a compose-managed container via `docker exec`), per-execution
CPU/memory limits are NOT enforced — the container's overall limits apply.

## Result envelope

Every execution — success or failure — returns a `SandboxResult`:

```ts
{
  executionId, status, exitCode,
  startedAt, finishedAt, durationMs,
  stdout, stderr, stdoutTruncated, stderrTruncated,
  artifacts: [{ name, bytes }, ...],
  failureClass,    // present unless status === "succeeded"
  failureMessage,
  retryable,       // true for timeout / nonzero_exit / job_start_failed / image_pull_failed
  resourceProfile, backend,
}
```

The tool never throws to the agent. Failures are surfaced as structured
results so the model can react.

## Failure taxonomy

| `status` | `failureClass` | When |
|---|---|---|
| `succeeded` | — | exit 0 |
| `failed` | `python_exception` | exit ≠ 0 with a Python traceback |
| `failed` | `nonzero_exit` | exit ≠ 0 without a traceback |
| `failed` | `validation_error` | bad request (unknown profile, bad artifact name, …) |
| `timeout` | `timeout` | killed because the effective timeout elapsed |
| `cancelled` | — | killed because the caller aborted via `AbortSignal` |
| `internal_error` | `job_start_failed` / `image_pull_failed` / `internal_error` | backend couldn't run |

Spec §20 classes that are intentionally absent: `policy_denied`,
`network_denied`, `dependency_denied`, `dependency_install_failed` — v1 has no
policy engine and no package install, and network is always `none`.

## Security model

### What v1 enforces

- **Docker layer (spec §7.1):** `--network none`, `--cap-drop ALL`,
  `--security-opt no-new-privileges`, `--read-only` rootfs, `--tmpfs /tmp`,
  `--user 65534:65534` (nobody), `--memory` / `--cpus` per profile, ephemeral
  workspace removed on exit.
- **Container layer (spec §7.2):** minimal base image, no cloud CLIs, no
  Docker socket, no deployment credentials, pinned image tag.
- **Runtime layer (spec §7.3):** fresh per-execution workspace, output caps
  with truncation flags, artifact size + count caps, frozen dependencies (no
  `pip install`), single Python entrypoint.
- **Input handling (spec §11):** code and artifacts delivered via bind mount,
  not environment variables. Only `EXECUTION_ID` and `RESOURCE_PROFILE` env
  vars reach the container. The host environment is explicitly scrubbed.

### What v1 does NOT enforce

- No policy engine (spec §18). Profile selection is the only knob.
- No multi-tenant isolation. Single-user, matching the rest of this repo's
  memory / filesystem assumptions.
- No outbound network at all (spec §9.1 only). `artifact-only`,
  `restricted-egress`, and `internet-enabled` modes are deferred.
- No package install. Frozen runtime only (spec §8.1).
- No GPU profile (spec §6.4).
- No metrics/tracing pipeline (spec §16.2–16.3). Structured JSON logs only.

## Writing a new backend

A new backend (E2B, Daytona, Vercel Sandbox, Modal, Cloud Run Jobs, …) is one
file + one test file. The tool layer never needs to change.

1. **Implement `SandboxBackend`** as a factory that delegates to the shared
   pipeline exported from `@deep-agent-template/sandbox/backend-helpers`.
   The existing backend (`docker-backend.ts` at ~255 LOC) is the canonical
   reference — copy it as a starting point. Each backend only supplies:

   - `executeWithHandling({ backendName, request, execOptions, workDirRoot, run, ... })`
     — the outer skeleton (profile resolution, workspace setup, cleanup wrap).
     Optional hooks: `preWorkspaceCheck` (e.g. daemon-availability gate),
     `createWorkspaceOptions` (chmod for non-root container users), `cleanup`
     (extra teardown beyond the workspace).
   - `runExecution({ backendName, request, execOptions, workDir, config, timeoutSeconds, startedAt, spawn, ... })`
     — the inner pipeline (race, collect, classify, envelope, log). Supply
     `spawn: () => ({ proc, kill })` and optionally `describeStartFailure` to
     sniff stderr for backend-specific start errors.

   You should not need to call `classifyFailure`, `buildResultEnvelope`,
   `collectStream`, or `structuredLogLine` directly — `runExecution` does that
   for you. The shared helpers (`createWorkspace`, `collectArtifacts`,
   `sanitizeEnvForHost`, `safeRm`) are also exported from `backend-helpers.ts`
   for the rare backend that needs to bypass the standard pipeline.

2. **Honor the contract:**
   - Apply `resourceProfile` limits in your backend's units (CPU/memory for
     containers; size templates for hosted APIs; job flags for Cloud Run).
   - Honor `options.signal` for cancellation — return
     `{ status: "cancelled" }` when it aborts.
   - Provide a fresh, isolated workspace per `executionId`. No state from one
     execution may leak into another.
   - Never log code, stdin, or full stdout/stderr.
   - Report `capabilities` honestly. The harness skips tests that don't apply
     (e.g. network denial for `isolation: "none"`).

3. **Add a test file** that calls `describeSandboxBackend()`:

   ```ts
   import { describeSandboxBackend } from "@deep-agent-template/sandbox/test";
   import { createE2bSandboxBackend } from "./e2b-backend.ts";

   describeSandboxBackend("e2b", () => createE2bSandboxBackend(), {
     skipIf: () => !process.env.E2B_API_KEY,
     timeoutMs: 30_000,
   });
   ```

   If your backend passes the harness, it satisfies the contract.

4. **Export the factory** from `backends/index.ts`.

That's it — `createPythonSandboxTool({ backend: createE2bSandboxBackend() })`
now works without any changes to the core tool package or runtime contracts.

## File layout

```
sandbox/
  infra/
    docker-compose.yml       Reference long-lived container configuration
  src/
    index.ts                 Public runtime barrel
    types.ts                 SandboxBackend, SandboxRequest, SandboxResult, …
    constants.ts             SANDBOX_PROFILES, caps, defaults
    profiles.ts              Profile resolution and validation
    envelope.ts              Result collection and failure classification
    backend-test-harness.ts  Shared backend acceptance suite
    backends/
      backend-helpers.ts     Shared execution pipeline
      docker-backend.ts      Container isolation backend
    *.test.ts                Unit + integration tests
```

## Spec coverage

v1 implements: §1, §2, §4, §5 (subset), §6 (no GPU), §7, §8.1, §9.1, §11,
§12, §13, §14, §15, §16.1, §17 (Docker-enforced controls), §19, §20, §21.1,
§22, §26 (acceptance cases 1–6, 10, 12, 14).

Deferred to future backends / versions: §6.4 (GPU), §8.2–8.3 (allowlisted /
custom packages), §9.2–9.4 (egress modes), §10 (Cloud Run IAM), §16.2–16.3
(metrics / tracing pipeline), §18 (policy engine), §21.2–21.4 (async lifecycle
tools), multi-tenancy.
