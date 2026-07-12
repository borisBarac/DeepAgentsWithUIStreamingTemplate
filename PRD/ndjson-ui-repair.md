# NDJSON UI Repair

Beads issue: `DeepAgentTemplate-5ho`

## Summary

Repair server-rejected UI output once. Preserve valid NDJSON updates, give structured validation feedback to the main agent, and request replacements only for rejected UI lines. If UI cannot be repaired, the agent returns a normal `message` update containing prose.

## Implementation

- Extend core spec validation with diagnostic results:
  - success: normalized `Spec`;
  - failure: structured issues containing path, code, and message.
- Preserve the existing `NormalizeSpec` callback for compatibility; add an optional diagnostic validator to `InteractionStreamOptions`.
- Refactor `createInteractionStream` to classify each attempted line as accepted, rejected UI candidate, or irrelevant malformed output.
- Treat parsed `type: "ui"` envelopes and malformed lines clearly containing a UI type/spec as UI candidates.
- Emit accepted updates once. On rejected UI candidates, invoke the main agent once more on the same thread with each rejected line and bounded validation issues.
- Limit repair feedback to 8 rejected lines, 10 issues per line, and 8 KiB total.
- Require replacement NDJSON only; do not repeat accepted updates. Permit a valid `{"type":"message","text":"..."}` prose response when UI cannot be produced.
- Keep repair feedback in agent thread state, but exclude it from visible/saved chat history.
- Reuse existing `main_agent_activity` events; add no new NDJSON event type.
- If the second attempt remains invalid, emit the existing fixed safe `message` fallback. Never expose raw invalid JSON as prose.

## Public interfaces

- Add `SpecValidationIssue`, `SpecValidationResult`, and `ValidateSpec`.
- Add optional `validateSpec` to `InteractionStreamOptions`; prefer it when both validators are supplied.
- Keep `UiUpdate` and `application/x-ndjson` unchanged.

## Acceptance tests

- Catalog rejection produces path-specific feedback and succeeds on retry.
- Malformed UI-intended JSON triggers repair; non-UI malformed lines do not.
- Mixed valid/invalid UI lines preserve valid components without duplication.
- Repair requests only rejected replacements.
- Repairing agent may return a normal prose `message`.
- Repair feedback persists in agent context but is absent from visible history.
- Existing activity events cover both attempts without entering chat.
- A second invalid attempt emits the safe prose fallback and stops.
- Legacy `normalizeSpec`, product-batch conversion, tolerant parsing, and route NDJSON framing remain compatible.

## Assumptions

- Only server-side validation failures are repaired; browser render exceptions are out of scope.
- Main agent performs repair.
- One repair attempt.
- Partial success is preserved.
- Prose fallback uses the existing `message` update, not a new UI component.
