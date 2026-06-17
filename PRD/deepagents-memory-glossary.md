# Deep Agents Memory Glossary

This glossary supports `PRD/deepagents-memory.md`.

## Domain Terms

### Single-User Agent Runtime

The v1 runtime assumption that one agent process or sandbox serves exactly one user. Local agents are single-user by nature. Server agents must be isolated in an agent sandbox so memory does not need to separate multiple users inside one running agent.

### Agent Sandbox

An isolated server-side execution environment for one agent and one user. In v1, sandbox isolation replaces authenticated multi-user memory namespacing.

### Shared Memory

Durable memory that can be read or written by more than one user, agent sandbox, or organization tenant. Shared memory is out of scope for v1.

### Single-User Namespace

The stable memory namespace used by the v1 runtime when persisting `/memory` files. It represents the one user associated with the local agent or isolated agent sandbox.

### Memory Module

The v1 package surface that owns default memory file paths, seed file content, namespace helpers, and policy wording for Deep Agents memory.

### Seed Memory Files

Initial contents for the default memory files. They describe what belongs in each file and give the agent concise update rules before any durable facts or preferences have been saved.

### Writable User Memory

Long-term memory files under `/memory` that the agent may edit during a conversation in the single-user runtime. V1 auto-approves writes to this memory because there is no second user or shared organization scope inside the sandbox.

### Auto-Approved Memory Write

A durable memory write performed by the agent without a human approval pause. The write is still a filesystem tool action and should remain observable, but it is not blocked by an interrupt in v1 for writable single-user memory.

### Explicit User Preference

A stable preference the user directly states, such as preferred response style, tooling choices, or workflow defaults. V1 memory may save these automatically when they are useful across future conversations.

### Stable Project Fact

A durable fact about the local project or environment, such as package manager choice, recurring commands, repository conventions, or known setup constraints. V1 memory may save these when they are likely to remain useful beyond the current task.

### Project Facts Memory

The writable v1 memory file at `/memory/project-facts.md`. It stores stable project and environment facts that should help future runs in the same single-user agent runtime.

### User Preferences Memory

The writable v1 memory file at `/memory/user-preferences.md`. It stores explicit user preferences that should influence future responses or workflows.

### Inferred Preference

A guessed preference derived from user behavior rather than a direct statement. V1 must not automatically persist inferred preferences.

### Transient Task Detail

Information useful only for the current request, run, thread, or temporary plan. Transient task details belong in short-term state or scratch files, not durable `/memory`.
