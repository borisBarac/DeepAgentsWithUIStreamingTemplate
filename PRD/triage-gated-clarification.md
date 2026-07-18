# Triage-Gated Clarification

Tracking issue: `DeepAgentTemplate-vemw`

## Summary

Replace the always-on mandatory clarifier preflight with a triage-gated flow. A cheap FAST_MODEL classifier inspects each new entry into the `clarification` phase and decides whether the full clarifier subagent round is needed. Self-contained, trivial, and continuation prompts (`continue`, `yes`, `ok`, `go ahead`, trivial factual prompts) skip the clarifier round entirely and transition straight to execution. Ambiguous or multi-step requests still go through the full preflight.

This is a behavior-level breaking change to the default scaffold. The legacy always-clarify behavior is recoverable via `ClarificationConfig.triage.enabled = false`.

## Problem Statement

Before this change, every new top-level request — regardless of how trivial or self-contained — incurred the cost of a clarifier subagent round: a FAST_MODEL delegation, a `workflow_submit_clarification` tool call, and only then progression to execution. For one-shot prompts (`what is 2+2`, `define CLI`, `write a haiku`) and continuation tokens (`continue`, `yes`, `go ahead`) this is pure overhead with no behavioral benefit. The clarifier is structurally incapable of declining to run: the workflow controller forces `phase=clarification` and rejects any non-clarifier delegation, and the only escape hatch is the clarifier itself returning `ready_to_proceed` with empty questions — which still costs a full model round-trip.

## Solution

Add a pre-clarifier **triage classifier** modeled on the guardrails pattern (`packages/core/src/guardrails/safety.ts`). The classifier runs in the workflow controller's `beforeAgent` hook, once per entry into the `clarification` phase. Its structured output is a binary `{ decision: "skip" | "proceed", reason: string }`. On `skip`, the controller synthesizes a `clarification_completed` event with `status: "ready_to_proceed"`, empty `questions`, and `skipReason: "triage_classifier"`; the reducer transitions the phase to `execution`. On `proceed`, the normal clarifier flow runs unchanged.

The classifier uses the existing `fast` model category via a new `triage` role in `MODEL_ROLES`. The default assignment is `triage: "fast"`, sharing the same tier as the clarifier and the guardrails classifier. The classifier prompt (`packages/core/prompts/clarification-triage.md`) is rendered via a new `getClarificationTriagePrompt` method on `PromptLoader`.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Decision maker | Lightweight FAST_MODEL classifier | Mirrors the guardrails pattern; preserves supervisor simplicity. |
| Trigger scope | Latest user message only (no cross-turn context) | v1 keeps tokens small; "continuation" detection works on lexical cues. Future v2 may pass the prior assistant turn. |
| Confidence threshold | None (binary decision) | v1 lets the model internalize confidence. Revisit if misjudgment rate is high. |
| Default behavior | New default (replaces always-clarify) | User explicitly approved the breaking change. |
| Disable mechanism | `ClarificationConfig.triage.enabled = false` | Existing config knob, finally made non-inert. |
| Audit trail | `ClarificationResult.skipReason` (optional field) | Respects PRD `clarification-round-cap-completion.md:42-44` ("no new public status"). `skipReason` is metadata, not a new status literal. |
| Exception handling | Safe-default to `proceed` | A flaky fast-model never blocks the run; classifier exceptions fall through to the normal clarify phase. |
| Memoization | `state.lastTriageMessage` | The same user message is not re-classified on subsequent `beforeAgent` invocations within a turn. |
| Mid-execution un-skip | Out of scope for v1 | The supervisor may still surface a clarifying question as a normal assistant message; a `workflow_reclarify` tool is deferred to v2. |

## Implementation Changes

### Production code

- **New module**: `packages/core/src/clarification/triage.ts` — schema, classifier interface, factory (`createClarificationTriageClassifier`), free function `classifyClarificationTriage`, safe default `PROCEED_TRIAGE_DECISION`, `TRIAGE_SKIP_REASON` constant.
- **New prompt**: `packages/core/prompts/clarification-triage.md` — classifier instructions covering skip/proceed heuristics.
- **Schema**: `packages/core/src/clarification/types.ts` — added `ClarificationSkipReason` type, `ClarificationTriageConfig` type, optional `skipReason?` field on `ClarificationResult` and `clarificationResultSchema`, new `clarificationSkipReasonSchema` enum, optional `triage?: ClarificationTriageConfig` on `ClarificationConfig`.
- **Defaults**: `packages/core/src/clarification/defaults.ts` — `DEFAULT_CLARIFICATION_TRIAGE_ENABLED = true`.
- **Config**: `packages/core/src/clarification/config.ts` — `createClarificationConfig` now resolves and freezes the `triage.enabled` flag.
- **Index exports**: `packages/core/src/clarification/index.ts` — surface new types, schema, factory, and constants.
- **Model roles**: `packages/core/src/models/constants.ts` — added `"triage"` to `MODEL_ROLES`; default assignment `triage: "fast"`.
- **Prompt loader**: `packages/core/src/prompts/index.ts` — added `getClarificationTriagePrompt()` to the `PromptLoader` interface and `MarkdownPromptLoader` impl; added `clarificationTriage` to `CORE_PROMPT_TEMPLATES`.
- **Workflow state**: `packages/core/src/workflow/types.ts` — extended `WorkflowState` with `lastTriageMessage?` and `lastTriageDecision?`; extended `WorkflowControllerOptions` with `triageClassifier?`, `triageEnabled?`, `promptLoader?`.
- **Workflow controller**: `packages/core/src/workflow/runtime.ts` — new `runTriageIfNeeded` hook invoked from `beforeAgent`. Synthesizes `clarification_completed` on `skip`. Memoizes via `lastTriageMessage`. Safe-defaults to `proceed` on any classifier exception.
- **Scaffold**: `packages/core/src/scaffold/types.ts` (added `triage: { enabled, classifier? }` to the scaffold output and `triageClassifier?` to options), `packages/core/src/scaffold/runtime.ts` (constructs the classifier from `modelRuntime.getModelForRole("triage")` unless explicitly overridden).
- **Scaffolded agent**: `packages/core/src/agent/scaffolded.ts` — threads `triageClassifier`, `triageEnabled`, and `promptLoader` into `createWorkflowControllerMiddleware`.
- **Supervisor prompt**: `packages/core/prompts/supervisor.md` — clarification block now describes triage-first behavior and the two acceptable paths the supervisor may see in the workflow envelope.
- **Clarifier prompt**: `packages/core/prompts/clarifier.md` — notes that the request has already passed triage; do not over-ask.

### Tests

- **New**: `packages/core/src/clarification/triage.test.ts` — schema acceptance/rejection, `PROCEED_TRIAGE_DECISION` invariants, prompt construction, `classifyClarificationTriage` happy/malformed paths, factory resolution order.
- **Updated**: `packages/core/src/clarification/types.test.ts` — `skipReason` optional + literal validation.
- **Updated**: `packages/core/src/clarification/config.test.ts` — `triage.enabled` default and override.
- **Updated**: `packages/core/src/workflow/runtime.test.ts` — new `describe("triage gate")` block with six cases: legacy fallback (no classifier), `triageEnabled: false`, skip path, proceed path, exception fallback, memoization, and follow-up `user_replied` re-triage.
- **Updated**: `packages/core/src/scaffold/runtime.test.ts` — expected scaffold shape now includes `triage: { enabled: false, classifier: undefined }` (test constructs scaffold without a model runtime) and `clarification.config.triage: { enabled: true }`.
- **Updated**: `packages/core/src/agent/index.test.ts`, `packages/core/src/scaffold/runtime.test.ts`, `packages/core/src/scaffold/subagents.test.ts` — `PromptLoader` stubs now implement `getClarificationTriagePrompt`.
- **Updated (live)**: `packages/core/e2e/workflow.e2e.test.ts` — accepts both triage-skip and clarifier-proceed paths; pins only the downstream ordering invariant (product-generator before review-agent) and the absence of `phase=error`.

### Docs

- `packages/core/README.md` — clarification section rewritten; role/category table now lists `triage`; example `assignments` block updated; new intake loop description.
- `.env.example` — `FAST_MODEL` comment now mentions the triage classifier.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Triage adds 1 extra LLM call per turn | Uses FAST_MODEL (same tier as clarifier). Net cost is neutral-to-negative because skip-path runs avoid the clarifier round entirely. |
| Triage misjudges and skips a genuinely ambiguous request | Supervisor prompt lets the supervisor still ask a clarifying question mid-execution via a normal message. Future v2: `workflow_reclarify` tool. |
| Live e2e becomes flaky if classifier judgment varies | Unit tests pin classifier contract via fakes; live e2e accepts both skip and proceed paths. |
| Breaking change for existing users | Documented. `ClarificationConfig.triage.enabled = false` restores legacy behavior. |
| Triage failure silently skips clarification | Safe-default: any classifier exception → fall through to `proceed`. |
| Schema migration: existing serialized `ClarificationResult` payloads | `skipReason` is optional; existing payloads still parse without modification. |

## Out of Scope

- `workflow_reclarify` tool to undo a bad skip mid-execution (deferred to v2).
- Passing prior-turn context to the classifier (v2 may pass a short summary of the previous assistant message).
- A confidence threshold on the classifier's decision (v1 is binary).
- A user-facing flow command (e.g. `/skip-clarify`) — the classifier handles continuation prompts without an explicit command. `skipReason: "user_command"` is reserved in the enum for future use.
- Wiring `ClarificationConfig.enabled = false` as a hard kill-switch at the workflow layer (still inert; `triage.enabled` is the v1 disable knob).

## Verification Gates

- `bun run typecheck`
- `bun test` (unit + updated workflow tests)
- `bun run check` (Biome; no new lint regressions)
- `bun run --filter @deep-agent-template/web-app build`
- Live e2e (opt-in): `bun test packages/core/e2e/workflow.e2e.test.ts` with LLM credentials — must pass for both skip and proceed paths.
