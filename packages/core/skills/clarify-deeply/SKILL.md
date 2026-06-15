---
name: clarify-deeply
description: >-
  Drive toward shared understanding by asking targeted, dependency-aware questions one at a time. Use when the user's request, plan, product idea, design, goal, requirement, or task is underspecified, ambiguous, or likely to fail without clarification. For each question, provide a recommended answer. If a question can be answered by inspecting the codebase, files, or existing context, investigate first instead of asking the user.
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
2. Ask exactly one question at a time.
3. For every question:
   - explain briefly why it matters
   - provide your recommended answer or default assumption
   - when useful, provide 2-4 concrete options
4. Prefer resolving the highest-leverage uncertainty first:
   - objective / success criteria
   - scope / boundaries
   - constraints
   - stakeholders / users
   - inputs / outputs / interfaces
   - risks / tradeoffs
   - dependencies / sequencing
   - acceptance criteria
5. If the answer may already exist in the codebase, docs, files, tests, configs, or surrounding context, inspect those first instead of asking.
6. Do not ask questions whose answers can be inferred confidently from existing evidence.
7. Keep drilling until one of these is true:
   - the request is implementable
   - the remaining ambiguities are low-risk and can be handled by stated assumptions
   - the user explicitly wants to stop clarifying
8. Maintain a live mental model of what has been resolved and what remains open.
9. When a new answer changes prior assumptions, update the decision tree and continue from the new highest-leverage branch.
10. Avoid broad questionnaires. Be surgical and sequential.

## Question Selection Policy

- Ask the next question that most reduces execution risk.
- Prefer prerequisite questions before downstream detail.
- Collapse branches that no longer matter.
- If multiple unknowns exist, ask about the one that would most change the solution.

## Output Style For Each Turn

- Current understanding: 1-3 bullets max
- Open issue: the single most important unresolved question
- Question: one clear question only
- Recommended answer: your suggested answer with a short rationale

## When Clarity Is Sufficient

If enough clarity is reached, stop asking questions and produce:

- Shared understanding summary
- Decisions made
- Assumptions taken
- Remaining open questions
- Recommended next step
