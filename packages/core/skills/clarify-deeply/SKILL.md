---
name: clarify-deeply
description: >-
  Drive toward shared understanding by asking targeted, dependency-aware questions. Use when the user's request, plan, product idea, design, goal, requirement, or task is underspecified, ambiguous, or likely to fail without clarification. Provide a recommended answer for each question when context justifies it.
---

# clarify-deeply

Your job is to eliminate ambiguity and surface hidden decisions until there is enough shared understanding to act confidently.

## Applies To

- plans
- products
- requests
- goals
- designs
- requirements
- implementation tasks
- migrations
- debugging efforts
- research tasks
- operational changes

## Behavior

1. Clarify by walking the decision tree, one dependency at a time.
2. Ask one question at a time by default. When the host accepts a structured readiness payload with a per-round question budget, you may return up to that budget in a single turn.
3. For every question:
   - explain briefly why it matters
   - provide a recommended answer only when context justifies it; do not recommend when the choice is genuinely preference-based
   - when useful, provide 2-4 concrete, mutually exclusive options
   - give each option a concise label and a one-sentence description
   - mark at most one option as recommended, and only when context justifies it
   - if useful options cannot be generated, omit them and ask the question directly
   - allow the user to answer outside the offered options
4. Prefer resolving the highest-leverage uncertainty first:
   - objective / success criteria
   - scope / boundaries
   - constraints
   - stakeholders / users
   - inputs / outputs / interfaces
   - risks / tradeoffs
   - dependencies / sequencing
   - acceptance criteria
5. Use what the user has already stated in this conversation before asking.
6. Keep drilling until one of these is true:
   - the request is implementable
   - the remaining ambiguities are low-risk and can be handled by stated assumptions
   - the user explicitly wants to stop clarifying
   - the host's round cap (`maxRounds`) is reached
7. Maintain a live mental model of what has been resolved and what remains open.
8. When a new answer changes prior assumptions, update the decision tree and continue from the new highest-leverage branch.
9. Avoid broad questionnaires. Be surgical and sequential.

## Question Selection Policy

- Ask the next question that most reduces execution risk.
- Prefer prerequisite questions before downstream detail.
- Collapse branches that no longer matter.
- If multiple unknowns exist, ask about the one that would most change the solution.

## Output Style For Each Turn

In free-form conversational use, structure each turn as:

- Current understanding: 1-3 bullets max
- Open issue: the single most important unresolved question
- Question: one clear question, or up to the host's per-round budget when batched rounds are supported
- Recommended answer: your suggested answer with a short rationale, only when context justifies it

When the host enforces a structured response format (for example a Zod `responseFormat`), return only the structured payload and omit this prose wrapper.

## When Clarity Is Sufficient

If enough clarity is reached, stop asking questions and produce:

- Shared understanding summary
- Decisions made
- Assumptions taken
- Remaining open questions
- Recommended next step

When the host enforces a structured readiness payload, map these into the payload fields instead of producing free text.
