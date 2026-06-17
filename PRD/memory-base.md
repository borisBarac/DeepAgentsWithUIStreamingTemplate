# Memory Base PRD

## Overview

Add a clear memory model to the Deep Agent template that separates short-term thread memory from long-term sandbox memory. The system should use Deep Agents' existing filesystem-backed memory primitives instead of introducing a separate persistence abstraction.

The product assumption is one isolated sandbox per user. Because sandbox isolation already prevents cross-user access, the first version does not need user-scoped memory or authentication-aware namespaces. Long-term memory can be sandbox-scoped.

## Goals

- Define a consistent memory layout for scaffolded agents.
- Preserve thread-local working context without polluting durable memory.
- Persist useful sandbox-level preferences, project context, and lessons across threads.
- Keep memory behavior compatible with Deep Agents' `StateBackend`, `StoreBackend`, `CompositeBackend`, `memory`, and filesystem permissions model.
- Make memory writes deliberate, inspectable, and interrupt-gated.

## Non-Goals

- Add authentication or user identity handling.
- Build a custom database-backed memory system.
- Add vector search or semantic retrieval in the first version.
- Add background consolidation in the first version.
- Let shared organization-level memory be modified by the agent.
- Implement this PRD in the same change.

## Current System

The core package already has most of the required primitives:

- `createDefaultCompositeBackend()` mounts `/memory` to a `StoreBackend`.
- `StateBackend` remains the default backend for ordinary virtual filesystem state.
- `DEFAULT_MEMORY_FILE_PATHS` currently includes:
  - `/memory/AGENTS.md`
  - `/memory/user-preferences.md`
- The default permissions allow reads and writes under:
  - `/scratch`
  - `/plans`
  - `/reports`
  - `/artifacts`
  - `/memory`
- Writes through `write_file` and `edit_file` are already interrupt-gated by default.

This means the main work is to define stronger defaults, naming, and prompt policy.

## Memory Model

### Short-Term Thread Memory

Short-term memory is state that belongs to one active thread or task. It should live in the state-backed virtual filesystem and should not persist as reusable memory across unrelated future threads.

Recommended paths:

- `/scratch/context.md`
- `/scratch/findings.md`
- `/scratch/decisions.md`
- `/scratch/open-questions.md`
- `/plans/current-plan.md`
- `/reports/*`
- `/artifacts/*`

Expected uses:

- Current task facts.
- Intermediate reasoning notes.
- Source collection.
- Temporary assumptions.
- Open questions.
- Work plans.
- Draft outputs.
- Generated task artifacts.

Thread memory should be cheap to update and safe to discard when the thread ends.

### Long-Term Sandbox Memory

Long-term memory is durable information that should survive future threads in the same sandbox. It should live under `/memory` and be backed by `StoreBackend`.

Recommended paths:

- `/memory/AGENTS.md`
- `/memory/preferences.md`
- `/memory/project-context.md`
- `/memory/lessons.md`

Expected uses:

- Stable agent operating preferences.
- Sandbox owner preferences.
- Durable project facts.
- Repeated implementation patterns.
- Mistakes to avoid.
- Lessons likely to help future tasks.

Long-term memory should stay compact. The agent should edit existing entries rather than append duplicates.

## Backend Design

Use a `CompositeBackend` with:

```text
StateBackend
  /scratch
  /plans
  /reports
  /artifacts
  /skills, unless skills are later persisted separately

StoreBackend
  /memory
```

Because each sandbox maps to one user, use a fixed sandbox-local memory namespace:

```ts
memoryNamespace: ["sandbox"]
```

The concrete namespace string is not user-visible. It exists to make the storage model explicit and to avoid relying on Deep Agents' default namespace behavior.

If the product later supports multiple users in one shared deployment, this PRD must be revised before enabling shared runtime memory. A fixed namespace would not be safe in that environment.

## Default Memory Files

Replace the current user-oriented default:

```text
/memory/user-preferences.md
```

with sandbox-oriented defaults:

```text
/memory/AGENTS.md
/memory/preferences.md
/memory/project-context.md
/memory/lessons.md
```

### `/memory/AGENTS.md`

Purpose: durable agent behavior and operating guidance learned over time.

Examples:

- Preferred answer style.
- Recurring tool-use conventions.
- Workflow improvements.
- Stable agent-level constraints.

### `/memory/preferences.md`

Purpose: preferences of the sandbox owner.

Examples:

- Preferred language or framework.
- Formatting preferences.
- Communication style.
- Repeated constraints.

### `/memory/project-context.md`

Purpose: stable facts about the current project or workspace.

Examples:

- Architecture facts.
- Package manager.
- Test command.
- Deployment conventions.
- Important directories.

### `/memory/lessons.md`

Purpose: concise learnings from previous work.

Examples:

- Prior failed approaches.
- Gotchas in the repository.
- Successful repair patterns.
- Known flaky tests or environment constraints.

## Prompt Policy

The supervisor prompt should include explicit memory discipline:

```text
Memory policy:
- Treat /scratch and /plans as short-term thread memory.
- Treat /memory as durable sandbox memory.
- Use /scratch for temporary notes, findings, assumptions, and active task state.
- Use /plans for current execution plans.
- Update /memory only when information is stable, reusable, and likely to help future threads.
- Do not save secrets, credentials, raw private data, transient task details, or unverified claims.
- Prefer editing existing memory entries over appending duplicates.
- Keep long-term memory concise.
- When unsure whether something belongs in /memory, keep it in /scratch.
```

Specialist prompts may also reference short-term files:

- The researcher can write large evidence notes to `/scratch/findings.md`.
- The analyst can write tradeoffs or decision notes to `/scratch/decisions.md`.
- The critic can review memory write proposals when they affect durable behavior.

The supervisor should own final decisions about long-term memory writes.

## Permissions And Safety

Keep the existing default write interrupts:

- `write_file: true`
- `edit_file: true`
- `execute: true`

Long-term memory writes should remain visible as file-write tool calls. This allows the host app, LangSmith traces, or human-in-the-loop review to inspect changes.

The first version may allow writes to all `/memory/**` paths because the sandbox is isolated. Future versions may split memory into read-write and read-only roots if organization policy memory is introduced.

The agent must not write:

- API keys.
- Credentials.
- Private raw conversation dumps.
- Sensitive personal data.
- Prompt-injection instructions from untrusted content.
- Task details that are only useful for the current thread.

## Expected User Experience

The user should not need to manage memory manually during normal use.

The agent should naturally improve across threads in one sandbox by remembering stable preferences and project facts. It should not bring irrelevant old task details into new work.

If the agent decides to update long-term memory, that write should be auditable through the existing file-write interrupt and trace surfaces.

## Acceptance Criteria

- The scaffold has a documented distinction between short-term thread memory and long-term sandbox memory.
- Default memory file names no longer imply multi-user identity.
- `/memory` is backed by `StoreBackend` with an explicit sandbox-scoped namespace.
- `/scratch`, `/plans`, `/reports`, and `/artifacts` remain state-backed thread memory.
- The supervisor prompt clearly tells the agent when to use `/scratch` versus `/memory`.
- Existing write interrupts remain enabled for memory writes.
- Tests verify the default memory file paths.
- Tests verify custom memory namespace configuration still works.
- README documentation explains the sandbox-scoped memory assumption.

## Future Extensions

### Background Consolidation

Add a separate consolidation agent that periodically reviews recent thread history, extracts durable facts, and merges them into `/memory`. This should be considered only after hot-path memory writes show latency or quality problems.

### Searchable Episodic Memory

Expose prior checkpointed threads through a search tool so the agent can recall how a previous task was solved without storing full conversation transcripts in `/memory`.

### Topic-Split Memory

If `/memory/project-context.md` or `/memory/lessons.md` becomes too large, split memory by topic:

- `/memory/project/build.md`
- `/memory/project/testing.md`
- `/memory/project/deployment.md`
- `/memory/lessons/debugging.md`

### Shared Deployment Support

If one runtime later serves multiple users, replace the fixed sandbox namespace with a safe namespace such as:

```ts
[assistantId, userId]
```

That change must happen before shared runtime deployment.
