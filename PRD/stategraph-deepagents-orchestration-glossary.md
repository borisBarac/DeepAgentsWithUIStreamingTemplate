# StateGraph Deep Agents Orchestration Glossary

This glossary supports `PRD/stategraph-deepagents-orchestration.md`.

## Domain Terms

### StateGraph

The LangGraph workflow controller that owns explicit state, deterministic routing, stage transitions, retries, approval pauses, and graph-level observability.

### Deep Agent

The agent runtime used inside graph nodes. In this repo it provides planning, tools, virtual filesystem access, memory routing, specialist subagents, skills, guardrails, interrupts, and context management.

### Orchestrated Deep Agent Graph

The optional StateGraph wrapper around one or more Deep Agent invocations. It is used when an application needs explicit stages and inspectable state rather than a fully autonomous single-agent flow.

### Outer Controller

The StateGraph layer that decides which stage runs next and whether execution should pause, retry, block, or finalize.

### Agent Node

A graph node that invokes a Deep Agent and writes the stage result back into graph state. Examples include `research`, `code`, and the model-backed `finalizer`.

### Deterministic Node

A graph node implemented in TypeScript logic without a model call. Examples include `route_intake`, clarification gating, approval checks, and the default finalizer.

### Graph Stage

A named workflow step owned by the outer graph. A stage may be deterministic or model-backed.

### Route

The graph state's selected next stage. The PRD's route values include `clarify`, `research`, `code`, `final`, `blocked`, and `end`.

### Routing Policy

The rules that decide the next route from task text, metadata, graph options, clarification state, prior node outputs, and errors. V1 routing is deterministic and unit-testable.

### Clarification Gate

The intake decision that determines whether the user must answer questions before work proceeds. It reuses the repo's existing clarification helpers and must not be bypassed by later graph stages.

### Work Branch

A productive stage selected after intake, such as research, coding, or direct finalization.

### Finalizer

The stage that turns graph state into the final user-facing response. V1 uses deterministic finalization by default and allows model-backed finalization only through explicit injection.

### Approval Gate

A graph-level pause before a sensitive transition, such as moving from research to code or finalizing a high-impact recommendation. Approval gates are separate from tool-call interrupts inside Deep Agents.

### Tool-Call Interrupt

An existing Deep Agents interrupt for operations such as file writes, file edits, or command execution. Tool-call interrupts happen inside an agent node, while approval gates happen between graph stages.

### Graph State

The typed state object passed between graph nodes. It includes the task, messages, clarification state, stage outputs, route, final answer, and errors.

### Stage Output

The result produced by a graph stage and stored in graph state, such as `researchResult`, `codeResult`, or `finalAnswer`.

### Structured Error

A recoverable node failure recorded in graph state. It should identify the node, failure category, message, retry count, and whether the failed stage was required.

### Required Stage

A graph stage that must succeed or explicitly pause before the graph can responsibly continue. Required clarification, safety, or approval gates cannot be silently skipped.

### Optional Stage

A graph stage that improves output quality but may fail without blocking finalization, provided the final response includes clear caveats.

### Blocked State

The terminal or paused condition reached after a required stage fails beyond its retry policy or an approval gate cannot proceed.

### Checkpointer

LangGraph persistence infrastructure for saving and resuming graph state. V1 should keep the state serializable and checkpointer-compatible, but checkpointing is optional.

### Virtual Filesystem Roots

The Deep Agents filesystem conventions reused by graph nodes: `/scratch`, `/plans`, `/reports`, `/artifacts`, `/memory`, and `/skills`.

### Durable Memory

Long-term memory stored under `/memory` through the configured store backend. Graph nodes should not write durable memory automatically.

### Over-Nesting

The failure mode where every Deep Agents subagent is also promoted to a top-level graph node. The graph should own business stages and approval boundaries; Deep Agents subagents should handle context isolation inside one stage.
