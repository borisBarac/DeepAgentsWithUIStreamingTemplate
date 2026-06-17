# Deep Agents Memory Decision Log

This decision log supports `PRD/deepagents-memory.md`. Status values are `proposed`, `accepted`, `rejected`, or `deferred`.

## ADR-001: Default Memory Scope

Status: accepted

### Context

The PRD proposed user-scoped memory as the default when a runtime user identity is available. That left local CLI, local development, and server-side sandbox deployments ambiguous.

### Decision To Make

Choose whether v1 should require an authenticated user id, disable memory without a user id, use thread-scoped memory, use assistant-scoped memory, or assume a single-user runtime.

### Decision

V1 assumes a single-user agent runtime. Local agents have exactly one user. Server deployments must run the agent inside an isolated agent sandbox, so each sandbox is treated as a single-user environment.

### Consequences

The first implementation does not need multi-user memory isolation, authenticated user identity plumbing, or cross-user namespace composition. Memory can default to a stable single-user namespace for the sandbox. Multi-user hosted deployments remain out of scope until the product explicitly needs them.

## ADR-002: User Memory Write Approval

Status: accepted

### Context

The PRD said durable memory writes must be interrupt-visible. In a multi-user hosted product this would usually imply human approval, host policy checks, or path-specific approval rules. The v1 product assumption is now simpler: each local runtime or server sandbox serves exactly one user.

### Decision To Make

Choose whether v1 user memory writes require human approval, host-app approval, automatic approval, final-answer proposals only, or host-owned mutation only.

### Decision

V1 auto-approves agent writes to writable single-user `/memory` files during normal conversation.

### Consequences

The first implementation should not require a memory-specific human approval loop for single-user memory. Write operations should still be visible as filesystem tool calls and observable in traces, but the default approval policy for writable user memory is automatic. Shared memory remains out of scope for v1, so this decision must not be generalized to organization-level or multi-user memory.

## ADR-003: Automatically Writable Memory Content

Status: accepted

### Context

Auto-approved memory writes need a tight content policy. If the agent can save anything it considers useful, the memory files will accumulate guesses, stale observations, and potentially sensitive material.

### Decision To Make

Choose whether v1 writable memory should include only explicit user preferences, explicit preferences plus stable project facts, inferred preferences, or arbitrary agent-selected notes.

### Decision

V1 writable memory may contain explicit user preferences and stable project facts. The agent must not automatically save inferred preferences, arbitrary observations, secrets, credentials, or transient task details.

### Consequences

The memory prompt and seed files should define the difference between explicit preferences, stable project facts, and transient observations. Tests can validate default seed content and memory policy wording, but live enforcement remains mostly prompt and filesystem-policy driven in v1.

## ADR-004: Default Memory File Layout

Status: accepted

### Context

The existing scaffold loads `/memory/AGENTS.md` and `/memory/user-preferences.md` by default. Under a writable single-user memory policy, `AGENTS.md` is ambiguous: it can look like editable system instructions, project notes, or agent identity memory.

### Decision To Make

Choose whether v1 keeps both existing files writable, makes `AGENTS.md` read-only, removes `AGENTS.md`, or replaces the layout with clearer file names.

### Decision

V1 replaces editable `/memory/AGENTS.md` with clearer memory files:

- `/memory/project-facts.md` for stable project and environment facts.
- `/memory/user-preferences.md` for explicit user preferences.

### Consequences

The default loaded memory paths should change from the existing scaffold default. Migration should be handled deliberately because current tests and README references expect `/memory/AGENTS.md`. The new layout reduces prompt-injection risk by avoiding an editable file name that implies high-priority agent instructions.

## ADR-005: Shared And Organization Memory Scope

Status: accepted

### Context

The original PRD included organization-level read-only memory and shared memory write restrictions. After ADR-001, v1 assumes each local runtime or server sandbox serves exactly one user.

### Decision To Make

Choose whether v1 should remove shared memory entirely, document it as future scope, support read-only organization memory, or support configurable shared routes with defaults off.

### Decision

V1 removes organization-level and shared memory from scope entirely.

### Consequences

The first implementation only needs a single-user `/memory` route. It does not need organization namespaces, shared policy mounts, read-only organization memory permissions, or shared-memory write approval rules. Shared memory can be reconsidered in a future PRD if the product introduces multi-user or organization deployments.

## ADR-006: V1 Implementation Surface

Status: accepted

### Context

After scope reduction, v1 could be as small as changing default memory file names or as large as runtime validation and consolidation. The product still needs enough structure that memory behavior is explicit and testable.

### Decision To Make

Choose whether v1 should only update scaffold defaults, add a dedicated memory module with helpers and seed files, add runtime write validation, or add background consolidation hooks.

### Decision

V1 adds a dedicated memory module with typed helpers, seed memory files, a single-user namespace helper, memory policy wording, and scaffold integration.

### Consequences

The implementation should introduce a clear package surface for memory instead of hiding the behavior inside scaffold constants. Runtime validation of memory writes and background consolidation are out of scope. Tests should target the exported memory helpers and the scaffold integration that consumes them.
