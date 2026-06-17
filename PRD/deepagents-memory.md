# Deep Agents Memory PRD

Companion docs:

- [Decision log](./deepagents-memory-adr.md)
- [Glossary](./deepagents-memory-glossary.md)

## Problem Statement

The template already mounts durable Deep Agents memory at `/memory`, but the product contract is still implicit. Builders need a clear, implementation-ready memory design so agents can remember useful preferences and operating context across conversations without turning memory into ambiguous editable instructions or a pile of transient notes.

Without a first-class memory product surface, each application has to decide its own file layout, seed data, write policy, and tests. That increases the chance of brittle defaults, stale memory, prompt-injection-prone file names, and inconsistent behavior between the default Deep Agent scaffold and future StateGraph orchestration.

## Solution

Add an explicit memory module around the existing Deep Agents scaffold. The memory module keeps `/memory` as the durable filesystem-backed mount, assumes a single-user agent runtime, loads two known writable memory files, and provides typed helpers for default file paths, seed file content, a single-user namespace, and memory policy wording.

The first version focuses on semantic memory for explicit user preferences and stable project facts. It removes organization/shared memory from scope, auto-approves writes inside the single-user runtime, and does not attempt runtime validation or background consolidation.

This PRD is based on LangChain's Deep Agents memory model: agents receive memory file paths through `memory`, read and edit those files through filesystem tools, and persist the files through configured backends and namespaces.

## User Stories

1. As an application developer, I want a documented default memory contract, so that I know what the scaffold remembers and why.
2. As an application developer, I want `/memory` to remain the durable long-term memory root, so that memory behavior matches Deep Agents filesystem conventions.
3. As an application developer, I want short-term scratch files to stay separate from long-term memory, so that temporary reasoning is not accidentally persisted.
4. As an application developer, I want v1 to assume a single-user runtime, so that local agents and isolated server sandboxes have a simple memory model.
5. As an application developer, I want a stable single-user namespace helper, so that memory persists predictably without requiring authenticated user identity plumbing.
6. As an application developer, I want default memory file paths to stay stable, so that downstream apps can seed and inspect memory predictably.
7. As an application developer, I want `/memory/project-facts.md` to store stable project and environment facts, so that future runs can reuse durable repo context.
8. As an application developer, I want `/memory/user-preferences.md` to store explicit user preferences, so that repeated conversations can reflect known preferences without asking again.
9. As an application developer, I want a typed memory module, so that default paths, seeds, namespace helpers, and policy wording are not scattered through scaffold code.
10. As an application developer, I want seed-memory helpers, so that a new store can be initialized with predictable starter files.
11. As an application developer, I want memory writes to continue using `edit_file` or `write_file`, so that existing Deep Agents behavior and traces remain understandable.
12. As an application developer, I want single-user memory writes to be auto-approved in v1, so that local and sandboxed agents can learn without a memory-specific approval loop.
13. As an application developer, I want memory behavior to be covered by unit tests, so that namespace, seed, and scaffold regressions are caught without live model calls.
14. As an application developer, I want the default scaffold and future StateGraph wrapper to share the same memory policy, so that orchestration does not create a second memory semantics.
15. As a user, I want the agent to remember stable preferences I explicitly ask it to remember, so that I do not repeat myself in future conversations.
16. As a user, I want the agent to remember stable project facts, so that it does not rediscover the same repo conventions every run.
17. As a user, I want the agent to apply remembered preferences only when relevant, so that memory improves answers instead of forcing stale behavior.
18. As a user, I want inferred preferences not to be saved automatically, so that memory reflects what I said rather than guesses about me.
19. As a user, I want secrets, credentials, and transient task details not to be saved automatically, so that durable memory does not become a liability.
20. As a user, I want the agent to update outdated preferences and project facts, so that memory reflects current instructions rather than old ones.
21. As an operator, I want memory writes to be traceable, so that I can audit what changed and which conversation caused it.
22. As an operator, I want concurrent write limitations documented, so that I can choose file granularity and consolidation strategy appropriately.
23. As a future agent implementer, I want procedural memory to remain represented as skills rather than mixed into semantic memory files, so that reusable procedures can be loaded on demand.
24. As a future agent implementer, I want episodic memory to be treated as thread checkpoint search rather than default memory-file loading, so that conversation history does not bloat the system prompt.
25. As a future agent implementer, I want memory files to stay concise, so that long-term memory helps context engineering instead of overwhelming the model.

## Implementation Decisions

- Keep `/memory` as the long-term memory root in the virtual filesystem layout.
- Replace the existing editable `/memory/AGENTS.md` default with `/memory/project-facts.md`.
- Keep `/memory/user-preferences.md` as the explicit user preference memory file.
- Treat loaded memory files as semantic memory: explicit user preferences and stable project facts.
- Keep short-term memory in graph state, Deep Agents state, checkpoints, `/scratch`, `/plans`, `/reports`, and `/artifacts`, not in `/memory`.
- Add a memory module that exports default paths, seed file content, a single-user namespace helper, and memory policy wording.
- Assume each runtime is single-user: local agents have one user, and server deployments must isolate each user in an agent sandbox.
- Use one stable single-user namespace by default.
- Keep memory backed by `StoreBackend` and routed through `CompositeBackend`; keep transient run state backed by `StateBackend`.
- Continue to accept an application-provided store backend, namespace factory, or full backend override for advanced deployments.
- Expose a stable memory namespace factory abstraction so application code does not hand-roll namespace functions.
- Durable memory writes must use Deep Agents filesystem tools. Do not introduce a hidden side channel that writes memory outside agent-visible tool calls.
- Auto-approve writes to writable single-user memory files in v1.
- Keep memory writes observable as filesystem tool calls and traceable runtime events where supported.
- Add seed helpers for initial memory file content. Seed helpers should be usable by tests and application bootstrap code.
- Seed file wording must define what belongs in `project-facts.md` and `user-preferences.md`.
- The allowed durable content is explicit user preferences and stable project facts.
- The agent must not automatically persist inferred preferences, secrets, credentials, arbitrary observations, or transient task details.
- Keep skills as procedural memory under `/skills`, not under `/memory`.
- If user-specific skills are needed later, mount `/skills` with a user or assistant-user namespace separately from `/memory`.
- Background consolidation is not part of v1 runtime behavior. It should be a future feature built as a separate consolidation agent that reads recent conversation history and merges concise facts into memory.
- StateGraph nodes must not write durable `/memory` automatically. They may produce stage outputs in graph state and virtual filesystem artifacts; durable memory remains an explicit agent action.
- Final user-facing responses should not claim that memory was saved unless the memory write actually succeeded.

## Testing Decisions

- Test the highest seam first: scaffold and memory configuration helpers, not live model behavior.
- Existing scaffold tests are the nearest prior art because they already verify default memory paths, permissions, backends, interrupts, and blueprint shape.
- Unit tests should verify that the default blueprint loads `/memory/project-facts.md` and `/memory/user-preferences.md`.
- Unit tests should verify that the default composite backend routes `/memory` to a store-backed backend while non-memory files remain state-backed.
- Unit tests should verify the single-user namespace helper.
- Unit tests should verify that default writable permissions include the v1 writable memory files.
- Unit tests should verify that memory writes can be auto-approved without disabling unrelated sensitive tool interrupts.
- Unit tests should verify that custom memory file paths can be supplied without removing the default permission safety model.
- Unit tests should verify seed helpers produce deterministic file data for the default memory files.
- Unit tests should verify seed file wording rejects inferred preferences, secrets, credentials, arbitrary observations, and transient task details as durable memory content.
- Integration-style tests can invoke a scaffolded agent with fake stores only if they do not require live model calls.
- Tests should assert external behavior and public contracts: exported helper outputs, blueprint fields, permissions, backend routing, and seed file structure.
- Tests should avoid asserting implementation details of Deep Agents internals beyond stable options this package already exposes.

## Out of Scope

- Building a memory management UI.
- Adding vector search over memory files.
- Implementing background consolidation in v1.
- Implementing episodic thread search in v1.
- Automatically extracting every conversation into memory.
- Supporting organization-level or shared memory.
- Supporting multi-user memory inside one running agent.
- Persisting inferred preferences automatically.
- Persisting secrets, credentials, arbitrary observations, or transient task details automatically.
- Runtime validation or parsing of every memory file write.
- Replacing Deep Agents filesystem-backed memory with a custom database API.
- Changing the default specialist roles.
- Changing the default StateGraph orchestration boundary.
- Adding Python code to this TypeScript-first repository.

## Further Notes

- LangChain Deep Agents memory distinguishes long-term memory from short-term conversation and scratch state. This repo should preserve that distinction.
- The default should favor concise, durable usefulness over aggressive learning.
- Single-user sandbox isolation is the v1 deployment assumption. Multi-user hosted memory needs a separate design.
- Concurrent writes can cause last-write-wins conflicts. V1 should reduce risk by keeping default memory files small and scoped per user; later consolidation can serialize higher-volume updates.
- Memory quality depends on concise files. Prompts and future consolidation should prefer updating or replacing stale facts rather than endlessly appending.

## Source Notes

- LangChain Deep Agents Memory: https://docs.langchain.com/oss/python/deepagents/memory
- Existing repo scaffold: `/memory` is the default durable root, `StoreBackend` backs memory, `StateBackend` backs non-memory state, and the current scaffold loads `/memory/AGENTS.md` plus `/memory/user-preferences.md`.
