# Review Agent Base Decision Log

This decision log supports `PRD/review-base.md`. Status values are `proposed`, `accepted`, `rejected`, or `deferred`.

## ADR-001: Relationship Between `critic` And `review-agent`

Status: accepted

### Context

The PRD proposes a default `review-agent`, but the TypeScript scaffold already includes a default `critic` subagent. The current `critic` challenges weak reasoning, missing evidence, and risky actions before final output.

### Decision To Make

Choose whether the review capability should:

- Rename or reshape the existing `critic` into `review-agent`.
- Add `review-agent` as a fifth default subagent.
- Keep `critic` and make it satisfy the review contract.
- Provide `review-agent` only as an optional exported preset.

### Decision

Delete the existing default `critic` role and replace it with `review-agent`. Do not retain a compatibility alias for `critic`.

### Consequences

Replacing `critic` keeps the default role count stable and makes the product concept explicit. This is a breaking change for users who already expect the `critic` role name or configure `subagentOverrides.critic`.

## ADR-002: Review Report Contract Format

Status: accepted

### Context

The PRD requires structured review output but currently shows a YAML-like shape. The existing scaffold already uses typed structured output for the `clarifier` subagent.

### Decision To Make

Choose whether review reports are enforced through a typed schema, prompt-only YAML, prompt-only JSON, or optional response formatting.

### Decision

Reuse the existing typed `responseFormat` pattern already used by the `clarifier` subagent.

### Consequences

A typed schema gives host applications reliable parsing and aligns with existing clarification behavior. Implementation should define a review report schema instead of relying on prompt-only YAML.

## ADR-003: Review Trigger Enforcement Boundary

Status: accepted

### Context

The PRD says the main agent should request review for non-trivial work and may skip trivial work. It does not yet define whether this is prompt-guided behavior or a runtime-enforced workflow.

### Decision To Make

Choose whether review triggering belongs in:

- Supervisor prompt guidance only.
- Middleware/runtime orchestration.
- A helper API that applications call explicitly.
- A later phase after the prompt-guided default ships.

### Decision

Review should be enforced by runtime behavior, not only by supervisor prompt guidance.

### Consequences

Runtime enforcement is more reliable and testable than prompt guidance alone, but introduces orchestration and state-management requirements beyond a subagent preset. The PRD needs to define the runtime boundary precisely.

## ADR-004: Reviewer Tool And Permission Model

Status: accepted

### Context

The PRD says the review agent should receive enough context to judge the result and must not perform destructive actions. The current scaffold initializes default specialist subagents with empty tools and shared interrupt settings.

### Decision To Make

Choose whether the default reviewer receives no tools, read-only tools, the same tools as the main agent, or configurable tool bundles.

### Decision

The review agent reviews only the context packet supplied by the main agent. Its core question is whether the candidate is good enough for the user or whether more work is required.

### Consequences

This keeps the reviewer safe and simple, but it means the reviewer is not an independent workspace verifier. The quality of review depends heavily on context packet completeness and honesty.

## ADR-005: Review History Persistence

Status: accepted

### Context

The PRD asks whether review history should be persisted for later audit and also asks for observability events where supported.

### Decision To Make

Choose whether the initial implementation stores review history in trace metadata only, virtual filesystem artifacts, memory, or not at all.

### Decision

Do not persist review history beyond the current run.

### Consequences

This keeps the base system simple and avoids lifecycle questions for trace, file, or memory persistence. It limits later auditability unless the host application adds its own logging.

## ADR-006: Initial Shippable Scope

Status: superseded

### Context

The proposed work can range from a narrow exported subagent preset to a runtime-enforced review system with typed output and observability.

### Decision

The initial shippable version includes the exported review subagent preset, default scaffold inclusion, supervisor prompt changes, typed review schema, and observability hooks.

### Consequences

This makes the feature meaningfully testable and product-complete, but it is no longer just a prompt/configuration change. The PRD should specify concrete runtime enforcement behavior and compatibility behavior for existing `critic` consumers.

## ADR-007: Finalization Boundary

Status: accepted

### Context

Runtime-enforced review requires a concrete boundary where the system can prevent unreviewed final output from being delivered.

### Decision

Finalization means `agent.invoke` returning a result that the host application sends to the user.

### Consequences

Review enforcement should be evaluated before or at the `agent.invoke` return boundary. This makes enforcement observable to host applications, but it requires a way to know whether the returned candidate has been reviewed.

## ADR-008: Runtime Enforcement Mechanism

Status: accepted

### Context

The desired enforcement mechanism depends on a future state system that does not exist yet.

### Decision

The PRD is not implementable before the future state system exists. There is no interim prompt-only, wrapper-only, or middleware-only implementation for this PRD.

### Consequences

The PRD depends on state-system work and should be treated as blocked until that foundation exists. Acceptance criteria must include the required review states and finalization guard rather than imply a near-term scaffold-only implementation.

## ADR-009: State-System-Gated Scope

Status: accepted

### Context

The feature requires runtime enforcement at the `agent.invoke` finalization boundary. That cannot be implemented responsibly without the future state system.

### Decision

Do not ship this PRD before the state system exists. The shippable scope is the state-integrated version: review subagent replacement, typed review schema, state transitions, finalization guard, revision loop behavior, and observability.

### Consequences

The PRD should name the state system as a hard dependency. Implementation sequencing should put state-system design and delivery before review-agent-base implementation.

## ADR-010: Minimum Review Lifecycle States

Status: accepted

### Context

Runtime enforcement needs explicit states that describe whether review is needed, underway, successful, failed, or blocked.

### Decision

The minimum review lifecycle states for final output are:

- `review_required`
- `review_requested`
- `changes_required`
- `approved`
- `blocked`

### Consequences

The future state system must expose enough state for the finalization guard to distinguish pending review, required revisions, approved work, and blocked/caveated delivery. Because the final result always requires review, the final-output path does not need a `review_not_required` state.

## ADR-011: Review Requirement For Final Output

Status: accepted

### Context

Earlier PRD language distinguished non-trivial and trivial tasks for review triggering. Runtime enforcement is simpler and stricter if every final result passes through review before `agent.invoke` returns.

### Decision

Review is always required before sending final output to the user.

### Consequences

The PRD should remove or narrow language that says review may be skipped for trivial final answers. If the product still wants fast trivial responses, that should be handled by a lightweight review path rather than bypassing review entirely.

## ADR-012: Context Packet Enforcement

Status: accepted

### Context

The review agent judges the candidate from the context packet supplied by the main agent. The product could enforce packet structure before review starts, or let the reviewer decide whether the supplied context is enough.

### Decision

Do not schema-enforce the context packet before review starts. The review agent decides whether missing context makes the review `blocked` or whether the candidate can still be judged.

### Consequences

This keeps review invocation flexible, but weakens guarantees that the reviewer sees changed files, validation, skipped validation, known caveats, and user constraints. The review prompt must explicitly treat missing decision-critical context as a reason to return `blocked`.

## ADR-013: Review Loop Limit

Status: accepted

### Context

The revision loop needs a stop condition so repeated `changes_required` results do not loop indefinitely.

### Decision

The maximum review loop count is configurable and defaults to 2.

### Consequences

After the configured review loop count is exhausted, the system must stop retrying and use caveated delivery rather than pretending review approval was achieved.

## ADR-014: Review Requirement For Progress Updates

Status: superseded

### Context

The finalization boundary initially focused on `agent.invoke` returning final output, but long-running agents may also send progress or status updates to the user before completion.

### Decision

Progress and status updates during long-running work count as user-visible output and require review.

### Consequences

The review gate applies to every user-visible message, not only the final result. This is a much stricter product requirement and may require state-system support for reviewing incremental messages without blocking the agent's internal work loop.

## ADR-015: Review Requirement Applies To Final Result

Status: accepted

### Context

Progress and status updates during long-running work were briefly considered user-visible output requiring review. That creates latency and recursion problems for routine updates.

### Decision

The review gate is intended for the final result sent to the user. Progress and status updates during long-running work do not require review.

### Consequences

The state system only needs to enforce review before final delivery. Intermediate user-visible updates can continue without review, but they should not contain unreviewed final conclusions or claim final completion.

## ADR-016: Domain-Specific Review Agents

Status: accepted

### Context

The base system could support specialized review agents for different domains, or keep one generalist review agent with a configurable prompt.

### Decision

Use exactly one base `review-agent`. This is a generalist system and should stay simple.

### Consequences

Domain-specific review behavior should be handled through prompt customization or host-level configuration, not additional default review agents.

## ADR-017: Conversational Final Message Review Input

Status: accepted

### Context

Some tasks produce only a final conversational answer, with no files, code diff, report, or separate artifact.

### Decision

For pure conversational answers, the review agent reviews just the candidate final message. The system needs to be in the final state before this review.

### Consequences

This keeps simple-answer review lightweight. It also means the review agent may have less context for conversational answers unless the final message itself exposes important caveats.
