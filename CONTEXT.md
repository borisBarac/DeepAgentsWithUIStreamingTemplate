# Context

## Domain Vocabulary

### Runtime scaffold

The Runtime scaffold is the core module interface that describes the default Deep Agent runtime shape. It owns the supervisor-specialist architecture, virtual filesystem layout, memory paths, backend, interrupts, permissions, subagents, supervisor prompt, and clarification metadata.

Callers use the Runtime scaffold when they need to inspect or override the default runtime shape before creating a scaffolded agent.

### Guardrail decision

The Guardrail decision is the core module interface that resolves the agent's preflight protections. It owns safety and task-scope enablement, task-scope policies, classifier selection, refusal behavior, and middleware ordering.

Callers use the Guardrail decision to inspect the resolved protection state and obtain the final middleware sequence, including caller-provided middleware.
