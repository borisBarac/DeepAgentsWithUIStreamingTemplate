# Review Agent Base PRD

## Overview

Add a built-in review subagent pattern to the Deep Agent template. The system should make final results safer by requiring the main agent to produce an output candidate, request a structured review from a dedicated review agent, and revise the candidate when the review identifies required changes.

The review agent is not a second implementer. Its role is to inspect completed work or a candidate final message for correctness, completeness, safety, adherence to the original user request, and unnecessary changes. The main agent remains responsible for planning, implementation, revision, and final delivery.

## Goals

- Provide a default `review-agent` subagent for scaffolded Deep Agents.
- Establish a clear review loop for final results.
- Produce structured review reports that are easy for the main agent and host application to parse.
- Catch incomplete work, incorrect behavior, missing validation, unsafe implementation choices, unnecessary changes, and missed edge cases before final response.
- Keep review behavior compatible with `create_deep_agent` and the existing subagent configuration model.
- Make the final response honest when review approval cannot be achieved.
- Integrate review enforcement with the future state system before this PRD is considered implementable.
- Keep the base review system generalist with one default `review-agent`.

## Non-Goals

- Replace human review, code review, QA, or security review.
- Automatically rewrite artifacts inside the review agent.
- Provide a review bypass for trivial final output.
- Add a new orchestration framework outside Deep Agents.
- Add domain-specific tools in this PRD.
- Add domain-specific review agents in this PRD.
- Define a scoring model that must be mathematically precise.
- Implement this PRD in the same change.
- Ship a prompt-only, wrapper-only, or middleware-only interim version before the state system exists.

## Current System

Deep Agents already support subagents through the `subagents` option on `create_deep_agent`. A subagent can be configured with:

- `name`
- `description`
- `prompt`

The proposed base configuration is:

```python
from deepagents import create_deep_agent

review_subagent = {
    "name": "review-agent",
    "description": "Reviews completed work for correctness, completeness, safety, and adherence to the user request.",
    "prompt": """
You are the Review Agent.

Your job is to review the artifact produced by the main agent.

Check:
- Does it satisfy the original user request?
- Is it complete?
- Is it correct?
- Are there edge cases missing?
- Is the implementation safe?
- Are there unnecessary changes?
- Are tests or validation missing?

Do not rewrite the artifact unless explicitly asked.
Return a structured review report with:
- status: approved | changes_required | blocked
- score: 0-100
- critical_issues
- major_issues
- minor_issues
- required_changes
- final_recommendation
"""
}

agent = create_deep_agent(
    model="openai:gpt-5.5",
    tools=[
        # your domain tools here
    ],
    system_prompt="""
You are the main deep agent.

Before final output:
1. Plan the task.
2. Produce the output candidate.
3. Ask the review-agent to review the candidate.
4. If the review requires changes, revise the candidate.
5. Do not finalize until the review is approved or you clearly explain remaining caveats.
""",
    subagents=[review_subagent],
)
```

This PRD expands that snippet into product behavior and implementation requirements.

## Product Behavior

### Main Agent Workflow

Before returning the final result, the main agent should follow this loop:

1. Understand the user request and constraints.
2. Create a short plan for the work.
3. Produce the requested artifact or implementation.
4. Send the final candidate artifact, original request, and relevant context to `review-agent`.
5. Read the review report.
6. If the review status is `approved`, finalize.
7. If the review status is `changes_required`, make the required changes and request another review when the changes are substantial.
8. If the review status is `blocked`, either resolve the blocker or explain the caveat clearly in the final response.

The main agent should not ask for review before the artifact is complete enough to inspect. Premature review creates noisy feedback and increases task cost without improving quality.

Finalization is the point where `agent.invoke` returns a result that the host application can send to the user. Runtime enforcement should guard this boundary so the final result cannot be returned unless review has approved it or caveats are explicitly surfaced.

Progress and status updates during long-running work do not require review before being sent, as long as they are not presented as the final result.

This PRD is not implementable before the future state system exists. The state system is a hard dependency because runtime enforcement needs durable review state before the `agent.invoke` finalization boundary.

### Review Agent Responsibilities

The review agent should inspect the candidate artifact against the original user request and available context.

It should check:

- Request satisfaction: whether the artifact answers or implements what the user asked for.
- Completeness: whether expected sections, features, files, or behaviors are missing.
- Correctness: whether claims, code, logic, or outputs are accurate.
- Edge cases: whether important failure modes or alternate inputs are ignored.
- Safety: whether the artifact introduces unsafe behavior, destructive actions, data leaks, or avoidable security risks.
- Scope control: whether unnecessary or unrelated changes were made.
- Validation: whether tests, checks, citations, or manual verification are missing for the risk level.

The review agent should not rewrite the artifact unless explicitly asked. It may suggest exact changes, but the main agent owns edits.

### Review Statuses

`approved` means the artifact is ready to deliver. Minor optional improvements may still be listed, but none should block finalization.

`changes_required` means the artifact has issues that should be fixed before delivery. These may include correctness gaps, missing requirements, incomplete validation, or unsafe choices.

`blocked` means the review agent cannot make a responsible decision because required information, access, or validation is unavailable. A blocked review should clearly state what is missing.

### Score

The review score is an approximate quality signal from `0` to `100`.

Recommended interpretation:

- `90-100`: Ready or nearly ready.
- `75-89`: Good but has meaningful issues to address.
- `50-74`: Material gaps or uncertain correctness.
- `0-49`: Not ready, unsafe, incorrect, or substantially incomplete.

The score should support the status, not contradict it. For example, `approved` should generally score at least `85`, while `blocked` should not score as production-ready.

## Review Report Contract

The review agent must return a structured report with these fields:

```yaml
status: approved | changes_required | blocked
score: 0-100
critical_issues:
  - issue: string
    impact: string
    evidence: string
major_issues:
  - issue: string
    impact: string
    evidence: string
minor_issues:
  - issue: string
    impact: string
    evidence: string
required_changes:
  - string
final_recommendation: string
```

Empty issue lists should be returned as empty arrays. The review agent should avoid vague comments such as "improve quality" unless it names the specific defect and required change.

## Prompt Requirements

### Review Agent Prompt

The default review agent prompt should be concise, strict, and artifact-focused:

```text
You are the Review Agent.

Your job is to review the artifact produced by the main agent.

Check:
- Does it satisfy the original user request?
- Is it complete?
- Is it correct?
- Are there edge cases missing?
- Is the implementation safe?
- Are there unnecessary changes?
- Are tests or validation missing?

Do not rewrite the artifact unless explicitly asked.
Return a structured review report with:
- status: approved | changes_required | blocked
- score: 0-100
- critical_issues
- major_issues
- minor_issues
- required_changes
- final_recommendation
```

### Main Agent Prompt

The main agent prompt should define when review is required and how to respond to review results:

```text
Before final output:
1. Plan the task.
2. Produce the output candidate.
3. Ask the review-agent to review the candidate.
4. If the review requires changes, revise the candidate.
5. Do not finalize until the review is approved or you clearly explain remaining caveats.
```

The host application may extend the prompt with domain-specific quality bars, tool usage rules, or validation requirements.

## Trigger Policy

Review is always required before final output is sent to the user. The review path may be lightweight for simple answers, but final delivery should not bypass review.

Review is especially important for:

- Multi-file code changes.
- User-facing behavior changes.
- PRDs, technical designs, migration plans, or implementation plans.
- Data analysis, reports, or decisions based on evidence.
- Security-sensitive, privacy-sensitive, destructive, or irreversible operations.
- Tasks where correctness depends on tests, external constraints, or careful interpretation.

Exploratory internal reasoning and progress/status updates do not require the review gate. The final result sent to the user requires review.

## Implementation Requirements

### State System Dependency

This PRD must not ship before the future state system exists. Review enforcement depends on state that can represent whether review is required, requested, approved, blocked, or still requiring changes.

The implementation must integrate with that state system rather than relying on prompt-only compliance.

The minimum review lifecycle states for final output are:

- `review_required`
- `review_requested`
- `changes_required`
- `approved`
- `blocked`

### Default Subagent

Provide a reusable review subagent definition:

```python
review_subagent = {
    "name": "review-agent",
    "description": "Reviews completed work for correctness, completeness, safety, and adherence to the user request.",
    "prompt": REVIEW_AGENT_PROMPT,
}
```

`REVIEW_AGENT_PROMPT` should be defined as a named constant where the template keeps default prompts.

### Agent Creation

The scaffolded agent should include the review subagent by default:

```python
agent = create_deep_agent(
    model="openai:gpt-5.5",
    tools=tools,
    system_prompt=MAIN_AGENT_PROMPT,
    subagents=[review_subagent],
)
```

The domain tool list should remain configurable. This PRD does not require the review agent to receive different tools from the main agent.

### Review Invocation Context

When asking for review, the main agent should provide:

- The original user request.
- The final candidate artifact or concise pointer to it.
- A summary of files changed, commands run, tests run, and known limitations when applicable.
- Any constraints the user gave.
- Any caveats the main agent already knows.

The review agent needs enough context to judge the result without guessing.

The default review agent should review only the context packet supplied by the main agent. It should not independently inspect workspace state or call tools in the base configuration. Its central judgment is whether the candidate artifact is good enough for the user or whether more work is required.

The context packet is not schema-enforced before review starts. If the packet omits decision-critical context, the review agent may return `blocked`.

For pure conversational answers with no files or separate artifact, the candidate final message is sufficient review input.

### Revision Loop

If `status` is `changes_required`, the main agent should:

- Address all `critical_issues`.
- Address all `major_issues` unless it can justify why a listed issue is incorrect or out of scope.
- Consider `minor_issues` when they are cheap and aligned with the user request.
- Request another review after substantial revisions.

The maximum review loop count should be configurable and default to 2.

The loop should stop when:

- The review returns `approved`.
- The remaining issues are explicitly out of scope.
- A blocker prevents further progress and is explained to the user.
- The user interrupts or redirects the task.
- The configured review loop count is exhausted, in which case the system uses caveated delivery rather than representing the result as approved.

## Safety And Quality Requirements

- The review agent must not perform destructive actions.
- The review agent must not introduce unrelated requirements.
- The review agent must distinguish blocking defects from optional polish.
- The main agent must not hide failed review results when finalizing with caveats.
- The main agent must not claim approval if the final review status was not `approved`.
- Reviews should prefer concrete evidence over generic advice.
- Review output should stay focused on the artifact, not the main agent's style or reasoning process.

## Observability

The system should make review outcomes visible in traces or logs where supported:

- Review requested.
- Review status.
- Review score.
- Required changes.
- Whether a follow-up review occurred.
- Final delivery status.

This enables quality monitoring without requiring users to inspect every subagent message.

The base system should not persist review history beyond the current run. Host applications may add their own persistence if they need auditability.

## Acceptance Criteria

- The required state system exists and can represent the review lifecycle.
- A scaffolded Deep Agent can be created with a default `review-agent` subagent.
- The final result is prevented from being sent unless review has approved it or blocked/caveated delivery is explicitly represented.
- The review agent returns the required structured fields.
- The main agent revises artifacts when review returns `changes_required`.
- The main agent can finalize with clear caveats when review is `blocked`.
- Simple requests can use a lightweight review path, but the final result still passes the review gate.
- Pure conversational answers can be reviewed using only the candidate final message.
- Review reports identify missing tests or validation when relevant.
- The review agent does not rewrite artifacts unless explicitly asked.
- The review loop limit is configurable and defaults to 2.
- Exhausting the review loop limit results in caveated delivery.

## Open Questions

- None currently.
