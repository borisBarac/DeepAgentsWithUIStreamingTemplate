# Review Agent Base Glossary

This glossary supports `PRD/review-base.md`.

## Domain Terms

### Artifact

The completed candidate output produced by the main agent before final delivery. An artifact can be code, a PRD, a plan, a report, generated files, or another deliverable requested by the user.

### Candidate Artifact

The specific artifact version submitted to a reviewer. It should be complete enough for judgment and accompanied by relevant context such as the original request, changed files, validation performed, and known caveats.

### Main Agent

The agent responsible for understanding the user request, planning, implementation, revision, and final response. It owns changes to artifacts and remains accountable for final delivery.

### Review Agent

A dedicated generalist subagent that inspects a candidate artifact or final message for request satisfaction, completeness, correctness, safety, scope control, edge cases, and validation. It does not implement or rewrite the artifact unless explicitly asked.

### Critic

The repo's existing default specialist subagent that challenges weak reasoning, missing evidence, and risky actions before final output. This role is deleted and replaced by `review-agent`; compatibility aliases are not retained.

### Review Report

The structured output returned by the review agent. The PRD currently requires status, score, issue lists, required changes, and a final recommendation.

### Review Status

The review agent's delivery decision for a candidate artifact:

- `approved`: ready to deliver.
- `changes_required`: defects should be fixed before delivery.
- `blocked`: the reviewer cannot make a responsible judgment due to missing access, information, or validation.

### Review Lifecycle State

The state-system value used to enforce review before finalization. The minimum lifecycle states are `review_required`, `review_requested`, `changes_required`, `approved`, and `blocked`. The final result always requires review, so `review_not_required` is not part of the final-output path.

### Required Change

A concrete revision that the main agent must address before claiming the artifact is ready, unless the main agent explicitly justifies why the change is incorrect or out of scope.

### Revision Loop

The cycle where the main agent submits a candidate artifact, receives a review report, revises required issues, and requests another review when the changes are substantial.

### Trigger Policy

The rules that decide whether review is required for a task. Review is always required before the final result is sent, and this must be enforced by runtime behavior rather than prompt guidance.

### Structured Review Contract

The schema or format that makes review reports machine-readable. Review reports should reuse the repo's typed `responseFormat` pattern.

### Context Packet

The bounded information bundle that the main agent submits to the review agent. The review agent judges whether the candidate is good enough for the user from this packet, rather than independently inspecting workspace state. The packet shape is not schema-enforced before review starts; the review agent may decide that missing context blocks responsible delivery.

For pure conversational answers with no files or separate artifact, the candidate final message is sufficient review input.

### Observability Event

A trace or log event that records review activity, including whether review was requested, review status, score, required changes, follow-up review, and final delivery status.

### Finalization

The point where `agent.invoke` returns a result that the host application can send to the user. Runtime review enforcement should guard this boundary.

### Caveated Delivery

Final delivery after the review loop limit is exhausted without approval. The final result must clearly disclose remaining caveats and must not claim review approval.

### User-Visible Output

The final result sent to the user. Progress and status updates during long-running work are not final results and do not require review.
