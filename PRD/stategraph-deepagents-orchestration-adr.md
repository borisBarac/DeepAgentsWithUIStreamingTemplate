# StateGraph Deep Agents Orchestration Decision Log

This decision log supports `PRD/stategraph-deepagents-orchestration.md`. Status values are `proposed`, `accepted`, `rejected`, or `deferred`.

## ADR-001: Orchestration Boundary

Status: accepted

### Context

The repo already exposes Deep Agents factories that handle planning, tools, filesystem access, memory, guardrails, interrupts, and specialist delegation. The proposed StateGraph layer could either replace that scaffold or sit above it.

### Decision To Make

Choose whether StateGraph becomes the primary agent runtime, an optional outer controller, or an internal implementation detail hidden behind `createBasicAgent(...)`.

### Decision

StateGraph is an optional outer controller. It owns deterministic workflow state, stage routing, retries, approval pauses, and finalization. Deep Agents remain the runtime inside model-backed nodes.

### Consequences

This keeps `createBasicAgent(...)` stable and avoids forcing graph semantics onto ordinary autonomous tasks. Graph adoption is explicit through a new orchestration module and factory.

## ADR-002: Initial Factory Surface

Status: accepted

### Context

The PRD proposes `createOrchestratedDeepAgentGraph(...)` as the primary graph factory. Earlier drafts also considered a debate-specific factory, but that would widen v1 before the base graph contract is proven.

### Decision To Make

Choose whether v1 ships a generic graph factory only or a broader family of workflow-specific factories.

### Decision

Ship `createOrchestratedDeepAgentGraph(...)` first. Treat any workflow-specific factory variants as deferred until the generic state contract, node wrapper, routing, and test harness are stable.

### Consequences

The first implementation has a smaller API surface and keeps the orchestration contract focused on the supported productive stages.

## ADR-003: Coding Specialist Boundary

Status: accepted

### Context

The default scaffold currently includes `clarifier`, `researcher`, `analyst`, and `critic`, but not a first-class `coder` specialist. The graph PRD includes a `code` stage.

### Decision To Make

Choose whether coding becomes a default Deep Agents specialist role, a graph-only node backed by `createBaselineAgent(...)`, or an application-provided custom agent.

### Decision

For v1, coding is a graph-level node backed by `createBaselineAgent(...)` or an injected custom agent. Do not add `coder` to the default scaffold.

### Consequences

This avoids expanding the default supervisor-specialist scaffold for a workflow-specific need. Applications that need coding orchestration can opt into the graph and provide a stronger coding prompt or custom agent.

## ADR-004: Approval Gate Mechanism

Status: accepted

### Context

The graph layer needs approval boundaries for stage transitions, while the current scaffold already has interrupts for tool calls such as writing files, editing files, and executing commands.

### Decision To Make

Choose whether graph-level approvals use LangGraph interrupts, host-application state only, both, or a custom approval abstraction.

### Decision

Use LangGraph interrupts for graph-level approval pauses and expose the relevant state snapshot for host applications to inspect. Keep existing Deep Agents tool interrupts unchanged inside nodes.

### Consequences

There are two explicit approval layers: graph transition approvals and tool-call approvals. Tests must verify that graph approval pauses expose route, node outputs, errors, and pending next stage.

## ADR-005: Finalizer Implementation

Status: accepted

### Context

The finalizer can be deterministic TypeScript formatting or a model-backed Deep Agent node. Model-backed synthesis can improve quality, but it adds nondeterminism to the final delivery boundary.

### Decision To Make

Choose whether v1 finalization is deterministic, model-backed, or configurable.

### Decision

Use deterministic finalization by default. Allow an injected finalizer agent only as an explicit option after the deterministic state-to-response contract is defined.

### Consequences

The default finalizer is testable and predictable. Rich synthesis remains possible for applications that knowingly accept model judgment at the final stage.

## ADR-006: Graph State Persistence

Status: accepted

### Context

LangGraph supports durable execution through checkpointers. The PRD also wants inspectable state snapshots, approval pauses, and retries.

### Decision To Make

Choose whether v1 requires persistent checkpointers, supports optional checkpointers, or keeps state in-memory only.

### Decision

Make checkpointing optional in v1. The graph state contract must be serializable and compatible with LangGraph checkpointers, but the first implementation should not require persistence infrastructure.

### Consequences

Local and unit-test usage stays simple. Host applications that need resumability can provide checkpointer configuration without changing the public state model.

## ADR-007: Routing Policy

Status: accepted

### Context

Routing can be deterministic TypeScript logic or a structured model call. The PRD emphasizes testability and predictable v1 behavior.

### Decision To Make

Choose whether v1 routing uses static rules, a model-backed router, or a hybrid.

### Decision

Use deterministic routing in v1. Route decisions should be derived from explicit options, clarification state, task metadata, and simple inspectable rules.

### Consequences

Route selection can be unit tested without live models. A structured model router remains a future extension after trace data shows static routing is insufficient.

## ADR-008: Node Error Contract

Status: accepted

### Context

Graph nodes may fail because of model errors, tool failures, permission interruptions, malformed outputs, or host cancellation. The PRD says recoverable errors should be written to `state.errors`.

### Decision To Make

Choose whether errors are strings, structured records, thrown exceptions, or node-specific result objects.

### Decision

Use structured error records internally and expose a stable public `errors` collection. Each error should identify the node, category, message, retry count, and whether the stage is required. The PRD's `string[]` shape is a simplified product sketch, not the final implementation type.

### Consequences

Host applications can inspect failures without parsing prose. The PRD should not lock implementation into plain strings if tests need richer behavior.

## ADR-009: Required Stage Failure Policy

Status: accepted

### Context

Some stages are optional, while others are mandatory for correctness or safety. Silently skipping required clarification, approval, or safety gates would violate the product purpose.

### Decision To Make

Choose whether failed required stages route to finalization with caveats, route to critic, retry indefinitely, or stop in a blocked state.

### Decision

Failed required stages retry according to policy, then stop in a blocked state. Optional stage failures may route to critic or finalizer with explicit caveats.

### Consequences

The graph must distinguish required and optional stages. Final output must not imply completion when a required stage failed.

## ADR-010: Deep Agent Node Wrapper

Status: accepted

### Context

Each graph node that invokes a Deep Agent needs to translate graph state into agent input and translate agent output back into graph state.

### Decision To Make

Choose whether each node implements this translation independently, or whether the orchestration module provides a shared wrapper helper.

### Decision

Provide a shared internal Deep Agent node wrapper. Node-specific logic should supply role instructions, state input selection, expected output key, retry policy, and required-stage metadata.

### Consequences

Common behavior such as tracing metadata, retry accounting, error capture, and state updates stays consistent across research, code, and finalizer nodes.

## ADR-011: Memory Writes From Graph Nodes

Status: accepted

### Context

The existing scaffold exposes `/memory` as durable sandbox memory. Graph nodes can also write stage artifacts to `/scratch` and `/reports`.

### Decision To Make

Choose whether graph nodes write durable memory automatically, only when instructed, or never.

### Decision

Graph nodes must not write durable `/memory` automatically. Stage outputs belong in graph state and stage-local virtual filesystem paths. Durable memory writes require explicit agent behavior and remain interrupt-visible.

### Consequences

The graph avoids contaminating long-term memory with intermediate or failed stage outputs. Applications can still opt into durable memory through existing backend and permission mechanisms.

## ADR-012: Clarification Gate Ownership

Status: accepted

### Context

The repo already has clarification helpers and a clarifier role. The graph needs a deterministic `route_intake` stage before work starts.

### Decision To Make

Choose whether clarification routing is deterministic helper logic, a clarifier Deep Agent invocation, or host-provided only.

### Decision

The initial clarification gate uses existing deterministic clarification helpers. A clarifier Deep Agent node may be used only for generating or refining user-facing questions after the gate decides clarification is needed.

### Consequences

The graph can enforce "do not proceed before clarification" without depending on prompt behavior. Question generation can still benefit from the existing clarifier role.
