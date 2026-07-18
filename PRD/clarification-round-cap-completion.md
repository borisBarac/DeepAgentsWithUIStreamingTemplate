# Clarification Round-Cap Completion

Tracking issue: `DeepAgentTemplate-2s0`

## Summary

Make the clarification cap a forced completion point: its final result becomes
`ready_to_proceed`, never terminally blocked. Add
`web-app:advanced:one-round` for live advanced-mode testing.

## Implementation Changes

- Add `WEB_APP_CLARIFICATION_MAX_ROUNDS` handling in the web-app advanced agent
  provider; parse a positive integer and pass it as
  `clarificationOptions.maxRounds` to `createScaffoldedAgent`.
- Add root script `web-app:advanced:one-round`, setting advanced mode and the
  new environment variable to `1`, while retaining existing scripts and the
  default two-round behavior.
- In clarification result normalization, when `roundCount === maxRounds`,
  resolve the state as `ready_to_proceed`, clear open and missing questions,
  and allow the gate to continue into product generation or execution.
- Update clarifier and supervisor prompts: at the cap, proceed using known
  context and clearly stated assumptions rather than returning or reporting
  `blocked`.
- Update the core README intake-loop description to document forced completion
  at the cap.

## Tests

- Agent-provider tests: default unchanged; `WEB_APP_CLARIFICATION_MAX_ROUNDS=1`
  reaches the scaffold; invalid values fail clearly.
- Clarification result tests: a final unresolved round becomes ready; no
  follow-up questions remain; state preserves supplied answers.
- Gate tests: cap-completed state enters the normal execution or
  product-generation route, not `blocked`.
- Prompt tests: rendered custom-cap prompts instruct completion rather than
  blocking.
- Run focused Bun tests plus root typecheck and check.

## Assumptions

- "Proceed" maps to existing `ready_to_proceed`; no new public status or type.
- Cap completion wins for an unresolved clarification result at that cap; an
  explicit `blocked` result before the cap remains blocked.
- The existing default remains two rounds.
- `ClarificationResult.skipReason` (added later by the triage-gated-clarification
  PRD) is an OPTIONAL METADATA FIELD on an existing status literal — it is not a
  new status. The "no new public status" rule above is preserved.
