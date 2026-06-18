# StateGraph Deep Agents Orchestration PRD

## Summary

Add an explicit LangGraph `StateGraph` orchestration layer around this repository's Deep Agents runtime for workflows that need deterministic routing, staged execution, approvals, retries, and inspectable state transitions.

The supported implementation is now narrower than the original proposal in this document: the active orchestration contract covers clarification, research, coding, finalization, and review. Any debate/judge material called out below is historical context only and is not part of the supported contract.

The current system already exposes a strong default Deep Agents scaffold through `packages/core`:

- `createBaselineAgent(...)` for a thinner single-agent harness.
- `createScaffoldedAgent(...)` and `createBasicAgent(...)` for the supervisor-specialist default.
- Default specialists: `clarifier`, `researcher`, `analyst`, and `review-agent`.
- Guardrails, clarification intake, filesystem permissions, interrupts, and `/memory` backend routing.

This PRD does not replace that scaffold. It defines when and how to add a higher-level `StateGraph` controller above it.

Companion docs:

- [Decision log](./stategraph-deepagents-orchestration-adr.md)
- [Glossary](./stategraph-deepagents-orchestration-glossary.md)

The intended mental model is:

```text
LangGraph StateGraph = deterministic outer workflow, state, routing, retries, persistence
Deep Agents = agent node runtime with planning, filesystem, subagents, memory, skills, context management
```

## Background

LangChain's TypeScript Deep Agents docs describe Deep Agents as a standalone agent harness with planning, file systems, subagents, long-term memory, streaming, and human-in-the-loop controls. They also state that Deep Agents uses LangGraph tooling for production agent execution. LangGraph's TypeScript docs frame LangGraph as the lower-level orchestration runtime for durable execution, streaming, human-in-the-loop, and persistence.

Relevant sources:

- [Deep Agents overview](https://docs.langchain.com/oss/javascript/deepagents/overview)
- [LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview)
- [Deep Agents GitHub repo](https://github.com/langchain-ai/deepagents)

## Problem

The repo currently has an opinionated Deep Agents scaffold, but orchestration is mostly delegated to the main agent prompt and Deep Agents' own subagent mechanism.

That is a good default for autonomous work, but some product flows need stronger external control:

- A mandatory sequence of business stages.
- Explicit route decisions that should be tested outside prompt behavior.
- Human approval gates before continuing to later stages.
- Retry or fallback policy around one stage without rerunning the entire task.
- Separate finalization after research, coding, or review.
- State snapshots that application code can inspect independently of the agent transcript.

Without an outer graph, these flows have to be encoded in prompts, middleware, or application-specific glue. That makes behavior harder to test and harder to reason about.

## Goals

- Introduce a documented product architecture for `StateGraph` as an optional outer controller.
- Keep the existing Deep Agents scaffold as the default runtime for ordinary autonomous tasks.
- Provide a TypeScript-first design that fits this repo's Bun workspace and `packages/core` exports.
- Reuse existing factories, prompts, guardrails, memory, permissions, and specialist roles.
- Support deterministic routing between specialist stages such as clarification, research, coding, finalization, and review.
- Preserve Deep Agents strengths inside graph nodes: planning, filesystem use, subagents, context management, and memory.
- Make the graph state explicit, typed, and testable.

## Non-Goals

- Rebuild Deep Agents' internal task planning.
- Replace the existing supervisor-specialist architecture.
- Let every specialist become both a StateGraph node and a Deep Agents subagent by default.
- Add distributed async workers in v1.
- Add a UI protocol such as A2UI in this PRD.
- Implement this PRD in the same change.
- Add Python examples to the TypeScript codebase.

## Recommendation

Use two runtime patterns:

```text
Pattern A: Deep Agent only
Default for autonomous research, coding, analysis, and general tool-heavy work.

Pattern B: StateGraph + Deep Agents as nodes
Use when the application needs explicit stages, deterministic routing, approvals, retries,
state snapshots, or review-gated workflows.
```

For this repo, Pattern B should be additive. Add a new orchestration module rather than changing `createBasicAgent(...)` semantics.

## Current System Fit

### Existing Runtime

The current core package already provides:

- `createBaselineAgent(...)`
- `createScaffoldedAgent(...)`
- `createBasicAgent(...)`
- `createSupervisorBlueprint(...)`
- `createDefaultCompositeBackend(...)`
- `createDefaultPermissions(...)`
- `createDefaultInterrupts(...)`
- clarification state helpers
- default guardrails
- markdown-backed prompt loaders
- specialized tool store helpers

The scaffolded agent currently uses:

```text
architecture: supervisor-specialists
specialists: clarifier, researcher, analyst, review-agent
state-backed roots: /scratch, /plans, /reports, /artifacts, /skills
store-backed root: /memory
interrupts: write_file, edit_file, execute
```

### Gap

The package does not currently expose `@langchain/langgraph` or a graph factory. The repo's `package.json` dependencies include `deepagents`, `langchain`, `@langchain/core`, and `@langchain/openrouter`, but not `@langchain/langgraph`.

### Product Implication

Add orchestration as a new package surface, for example:

```text
packages/core/src/orchestration.ts
```

Do not overload `createBasicAgent(...)`. That function should stay the familiar scaffolded default.

## Proposed Product Design

## 1. High-Level Architecture

```text
User / API
  -> StateGraph app
      -> route_intake
      -> clarification_node
      -> research_node
      -> coding_node
      -> finalizer_node
      -> review gate
  -> final response
```

Each node may be either:

- deterministic TypeScript logic, or
- a Deep Agent invocation created through this repo's agent factories.

## 2. Recommended First Graph

The first graph should support this workflow:

```text
START
  -> route_intake
  -> clarify, when required
  -> research, code, or final
  -> finalizer
  -> review gate
  -> END
```

This maps naturally to the current specialist roles:

| Graph stage | Preferred implementation | Existing repo fit |
|---|---|---|
| `route_intake` | deterministic TypeScript router | new graph logic |
| `clarify` | existing clarification helpers or `clarifier` Deep Agent node | `clarification.ts`, `clarifier` prompt |
| `research` | Deep Agent node | `researcher` role and tools |
| `code` | Deep Agent node or future coding specialist | `createBaselineAgent` with coding prompt |
| `finalizer` | deterministic formatter or Deep Agent node | new prompt or baseline agent |
| review gate | structured `reviewer` invocation | existing review contract |

## 3. Agent Boundary Rules

To avoid over-nesting:

1. Use `createBaselineAgent(...)` for graph nodes that represent one explicit stage.
2. Use `createScaffoldedAgent(...)` only when a graph node needs its own internal supervisor-subagent behavior.
3. Do not make every existing Deep Agents subagent a top-level graph node by default.
4. Prefer top-level graph nodes for business stages and approval boundaries.
5. Prefer Deep Agents subagents for context isolation inside one stage.

## 4. TypeScript API Shape

Add a new graph factory:

```ts
export function createOrchestratedDeepAgentGraph(
  options?: CreateOrchestratedDeepAgentGraphOptions,
): CompiledStateGraph<OrchestratedDeepAgentState>;
```

Proposed options:

```ts
export type CreateOrchestratedDeepAgentGraphOptions = {
  agents?: {
    researcher?: DeepAgent;
    coder?: DeepAgent;
    finalizer?: DeepAgent;
    reviewer?: DeepAgent;
  };
  routing?: {
    enableResearch?: boolean;
    enableCoding?: boolean;
  };
  clarification?: Partial<ClarificationConfig>;
  guardrails?: false | CreateDefaultGuardrailsOptions;
  review?: Partial<ReviewConfig>;
  promptLoader?: PromptLoader;
};
```

Proposed state:

```ts
export type OrchestratedDeepAgentRoute =
  | "clarify"
  | "research"
  | "code"
  | "final"
  | "blocked"
  | "end";

export type OrchestratedDeepAgentError = {
  node: string;
  category: "model" | "tool" | "permission" | "validation" | "host" | "unknown";
  message: string;
  retryCount: number;
  required: boolean;
};

export type OrchestratedDeepAgentState = {
  task: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  clarification?: ClarificationState;
  researchResult?: string;
  codeResult?: string;
  finalAnswer?: string;
  review?: ReviewState;
  next: OrchestratedDeepAgentRoute;
  errors: OrchestratedDeepAgentError[];
};
```

The concrete implementation should use the current LangGraph TypeScript state API. The public types above are the product contract, not necessarily the exact internal LangGraph schema.

## 5. Node Behavior

### `route_intake`

Deterministically decides whether a new task must pass through clarification before work starts.

This node should reuse:

- `createClarificationState(...)`
- `resolveClarificationGate(...)`
- `selectUserFacingQuestions(...)`

### `clarify`

Runs the clarification process and either:

- returns user-facing questions and stops the graph for user input, or
- marks the task ready to proceed.

This stage should not perform research, coding, or final synthesis.

### `route_work`

Chooses the next work branch based on the task and configuration.

Initial routing can be simple deterministic keyword and metadata routing. Later versions can add a structured router model, but v1 should stay testable and predictable.

### `research`

Invokes a Deep Agent configured as a research specialist.

Expected output:

- concise findings
- source notes when available
- unresolved questions
- recommended next stage

### `code`

Invokes a Deep Agent configured as a coding or implementation specialist.

Expected output:

- implementation guidance
- changed-file plan when applicable
- risks and test recommendations

### `finalizer`

Produces the final user-facing response from state.

For v1, prefer deterministic formatting when possible. Use a Deep Agent finalizer only when synthesis quality materially benefits from model judgment.

Every finalized candidate is submitted to the structured reviewer. Approval delivers the candidate; required changes enter the bounded revision loop; blocked or unapproved results are delivered only with explicit caveats.

## Historical Debate Appendix

The following section preserves the earlier debate-oriented proposal for reference only. It is not part of the supported implementation contract above and should not be treated as current API guidance.

### Multi-Agent Debate Product Shape

For the user's debate-style system, use `StateGraph` as the outer controller and Deep Agents for specialized nodes:

```text
START
  -> route_intake
  -> argument_generator_a
  -> argument_generator_b
  -> fact_checker
  -> judge
  -> finalizer
  -> review gate
  -> END
```

Recommended role mapping:

| Debate role | Node type | Notes |
|---|---|---|
| `argument_generator_a` | Deep Agent node | constrained to one position |
| `argument_generator_b` | Deep Agent node | constrained to opposing position |
| `fact_checker` | Deep Agent node | source-backed only |
| `judge` | Deep Agent node | adjudicates with rubric |
| `finalizer` | deterministic or Deep Agent | emits concise answer |
| review gate | structured reviewer | approves delivery or requires revisions |

Do not implement debate by letting one Deep Agent recursively spawn unconstrained subagents. The outer graph should own debate turn order, role separation, and judge criteria.

## 6. Memory And Filesystem Policy

Graph nodes should share the same virtual filesystem conventions as the current scaffold:

```text
/scratch    stage-local notes and intermediate findings
/plans      active execution plans
/reports    stage outputs and final reports
/artifacts  generated artifacts
/memory     durable sandbox memory through StoreBackend
/skills     read-only bundled skills
```

Recommended graph-specific paths:

```text
/scratch/orchestration-state.md
/scratch/research-result.md
/scratch/code-result.md
/reports/final.md
```

Durable `/memory` writes should remain rare, deliberate, and interrupt-visible.

## 7. Safety And Approvals

Keep the existing default interrupts:

```text
write_file: true
edit_file: true
execute: true
```

The graph layer should add approval boundaries for stage transitions, not just tool calls.

Examples:

- require approval before moving from `research` to `code`
- require approval before executing destructive implementation steps
- require approval before finalizing a high-impact recommendation

The v1 graph should expose state at each approval point so a host app can inspect:

- route decision
- node outputs
- errors
- pending next stage

## 8. Error Handling

Each node should return a typed error into `state.errors` rather than throwing whenever recovery is possible.

Minimum v1 behavior:

- one retry for transient model/tool failures
- route to `finalizer` with caveats when optional stages fail
- stop with a clear blocked state when required stages fail

Do not silently skip required clarification, safety, or approval gates.

## 9. Observability

The graph should preserve current LangSmith support through `configureLangSmithTracing(...)`.

Graph runs should make the following visible in traces:

- selected route
- node entry and exit
- Deep Agent invocation per node
- approval pauses
- retries
- final state summary

## Product Deliverables

## 1. Dependency

Add `@langchain/langgraph` to `packages/core`.

Expected command:

```sh
bun add @langchain/langgraph --cwd packages/core
```

## 2. Core Orchestration Module

Add:

```text
packages/core/src/orchestration.ts
```

Exports:

- `createOrchestratedDeepAgentGraph`
- `OrchestratedDeepAgentState`
- `OrchestratedDeepAgentRoute`
- `CreateOrchestratedDeepAgentGraphOptions`

## 3. Index Exports

Update:

```text
packages/core/src/index.ts
```

to export the new orchestration API.

## 4. Prompt Support

Add optional prompt loader methods only if needed:

- `getCoderPrompt()`
- `getFinalizerPrompt()`

Do not add these until graph nodes require model-backed behavior for those roles.

## 5. Tests

Add focused tests:

- route selection for research, coding, comparison-style prompts, and final-only tasks
- clarification gate behavior
- graph state shape
- failed-node error propagation
- finalizer output composition
- custom agent injection through options

Use mocked Deep Agents for graph tests. Live model tests should remain separate from default unit tests.

## 6. Documentation

Update `packages/core/README.md` with:

- when to use Deep Agent only
- when to use StateGraph plus Deep Agent nodes
- a minimal TypeScript invocation example
- warning against unnecessary over-nesting

## Example TypeScript Usage

```ts
import { createOrchestratedDeepAgentGraph } from "@deep-agent-template/core";

const graph = createOrchestratedDeepAgentGraph({
  routing: {
    enableResearch: true,
    enableCoding: true,
  },
});

const result = await graph.invoke({
  task: "Research Redis streams and propose a Node.js consumer implementation.",
  messages: [
    {
      role: "user",
      content: "Research Redis streams and propose a Node.js consumer implementation.",
    },
  ],
  next: "research",
  errors: [],
});

console.log(result.finalAnswer);
```

## Acceptance Criteria

- The repo has a documented StateGraph orchestration product design adapted to its TypeScript Deep Agents scaffold.
- The design keeps `createBasicAgent(...)` as the default scaffolded Deep Agent entrypoint.
- The design introduces a separate graph factory for explicit outer orchestration.
- The graph state includes task, messages, stage outputs, route, final answer, and errors.
- The PRD explains when to use graph nodes versus Deep Agents subagents.
- The active contract covers clarification, research, coding, finalization, and review only.
- The PRD reuses existing guardrails, clarification, memory, permissions, prompt loader, and observability concepts.
- The PRD identifies `@langchain/langgraph` as a required new dependency.
- The PRD includes implementation deliverables and test requirements.

## Open Questions

- Should coding be a first-class specialist role in the default scaffold, or only a graph-level node backed by `createBaselineAgent(...)`? Resolved by ADR-003.
- Should graph-level approval gates use LangGraph interrupts directly, host-app state, or both? Resolved by ADR-004.
- Should finalization be deterministic formatting in v1, or a model-backed Deep Agent node? Resolved by ADR-005.
- Should graph state be persisted through LangGraph checkpointers in the first implementation pass? Resolved by ADR-006.

## Future Extensions

### Parallel Branches

Run research and coding proposal branches in parallel when the task benefits from independent exploration.

### Async Workers

Move long-running graph nodes to async subagents or separate deployments when tasks exceed interactive latency budgets.

### Structured Router

Replace deterministic routing with a structured-output router only after unit tests and trace data show that static routing is too limited.

### Evaluation Harness

Add LangSmith datasets for route accuracy, review effectiveness, and end-to-end task success.
