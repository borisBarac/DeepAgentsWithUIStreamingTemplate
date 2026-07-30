# E2E: Workflow Controller Happy Path (Live LLM)

## Problem Statement

Contributors can refactor the workflow controller (the LangChain middleware in `packages/core/src/workflow/runtime.ts` that drives the `clarification → execution → product_generation → review → delivery_ready` phase state machine) without any live signal that an actual LLM-driven DeepAgent still progresses through every mandated phase.

Today, the workflow has three layers of coverage:

- `reducer.test.ts` — pure reducer state transitions.
- `runtime.test.ts` — drives each middleware hook (`beforeAgent`, `afterModel`, `wrapToolCall`) directly with hand-built `ToolCallRequest` payloads. It proves the wiring but not that a real model can satisfy it.
- The phase-specific e2e tests (`subagents.e2e.test.ts`, `generative-ui.e2e.test.ts`, `review.e2e.test.ts`) each isolate a single subagent delegation. None of them assert that the workflow controller forces the **sequence** of delegations a new user request is supposed to trigger.

So a regression that lets the supervisor skip clarification, or finalize before review, would slip through. We need one live-model e2e that proves a fresh user request, sent through the production `createScaffoldedAgent` wiring, ends in `delivery_ready` after the controller has nudged the agent through every required subagent in order.

## Solution

Add a single live-LLM e2e test, `packages/core/e2e/workflow.e2e.test.ts`, gated by `hasLiveLLMCredentials`, that:

1. Builds a scaffolded agent exactly as the web app does — `createScaffoldedAgent({ modelRuntime, guardrails: false, generativeUi: {} })` — so the workflow controller middleware is wired in via the same code path production uses (`packages/core/src/agent/scaffolded.ts`).
2. Sends one short, self-contained user request whose scope is small enough that the clarifier marks it `ready_to_proceed` in a single round and the supervisor has a concrete deliverable to submit via `workflow_complete_execution`.
3. Asserts on the resulting transcript — without touching production code — that the controller intervened, forced each required subagent delegation in order, never produced a terminal failure, and that the supervisor delivered a non-narration final message.

The test reuses the existing e2e helpers (`createDefaultModelRuntime`, `hasLiveLLMCredentials`, `findToolMessage`, `AgentInvokeResult`) and the transcript-stringification helper already inlined in `guardrails.e2e.test.ts` and `memory.e2e.test.ts`. No new helpers, no production changes.

## User Stories

1. As a core maintainer, I want a live e2e test that proves a fresh request walks the full workflow happy path, so that I can refactor the workflow controller with confidence.
2. As a core maintainer, I want the test to assert that the workflow controller **forces** clarification before any other phase, so that I detect regressions where the supervisor skips the clarifier without authorization. The clarifier itself decides whether questions are needed and may return `ready_to_proceed` in its first round.
3. As a core maintainer, I want the test to assert that the controller forces a `product-generator` delegation after `execution_completed` when generative UI is enabled, so that the `product_generation` gate is preserved.
4. As a core maintainer, I want the test to assert that the controller forces a `review-agent` delegation after product generation, so that no delivery can happen without review.
5. As a core maintainer, I want the test to assert that the run ends in delivery (no `phase=error` marker, final assistant message is a real deliverable), so that I know the supervisor actually finished rather than getting stuck.
6. As a contributor onboarding to the codebase, I want the test to read like the other e2e tests in the same folder, so that I can copy its shape when adding the next workflow-scenario test.
7. As a contributor onboarding to the codebase, I want the test name and `console.log(result)` to make the workflow phases obvious on failure, so that I can debug flaky live-model runs without re-reading the middleware source.
8. As a release engineer, I want the test to be skipped automatically when `RUN_LIVE_E2E` is unset or credentials are absent, so that CI without LLM access does not break.
9. As a release engineer, I want the test picked up by the existing `bun run test:e2e` invocation in `packages/core/package.json`, so that no new test runner or script is required.
10. As a future contributor, I want the PRD to call out explicitly what is **out of scope** (revision loops, `waiting_for_user`, store-persistence), so that follow-up e2e tickets have a clear starting point.

## Implementation Decisions

- **File:** `packages/core/e2e/workflow.e2e.test.ts`. Sibling to `subagents.e2e.test.ts`, `generative-ui.e2e.test.ts`, `review.e2e.test.ts`, `memory.e2e.test.ts`, and `guardrails.e2e.test.ts`.
- **Gate:** `describe.skipIf(!hasLiveLLMCredentials)` — identical to all other e2e tests in the folder. `hasLiveLLMCredentials` already requires `RUN_LIVE_E2E=1` plus `LLM_BASE_URL` and `LLM_API_KEY`.
- **Model runtime:** `createDefaultModelRuntime(false)` from `./helpers.ts` — thinking disabled, same as `review.e2e.test.ts` and `memory.e2e.test.ts`. Thinking-off keeps the run cheap and stable.
- **Agent wiring:** `createScaffoldedAgent({ modelRuntime, guardrails: false, generativeUi: {} })`. Passing `generativeUi: {}` flips `scaffold.productGeneration.enabled` to `true` (per `packages/core/src/scaffold/runtime.ts`), which in turn flips the workflow controller's `generativeUiEnabled` flag, routing `execution_completed` into the `product_generation` phase rather than straight to `review`. Guardrails off avoids the safety/task-scope model calls that would otherwise add noise and round trips.
- **Default subagent catalog:** the scaffolded factory already instantiates `createDefaultSubagentCatalog` when `subagents` is omitted, which includes the `clarifier` and `review-agent` subagents and — because `generativeUi: {}` is set — the `product-generator` subagent. The test does not pass a custom catalog.
- **Prompt strategy:** short, self-contained, deliverable-in-one-shot task in the style of `review.e2e.test.ts`. The request must be concrete enough that the clarifier marks it ready in one round and the supervisor has a clear candidate final response to submit via `workflow_complete_execution`. Scope small enough that the reviewer can plausibly approve on the first pass.
- **Assertion seam (single):** the agent's returned transcript. This is the highest seam available — it is the public output of `agent.invoke({ messages })` and requires zero production changes. The workflow controller's feedback messages are visible in the transcript because `afterModel.hook` injects them as `HumanMessage`s (the `WORKFLOW_CONTROLLER_FEEDBACK phase=… requiredAction=… requiredSubagent=…` envelope produced by `feedbackMessage(state)`) and the `task` tool messages carry the `subagent_type` argument for each delegation.
- **Transcript helper:** inline `stringifyMessageContent` + `transcriptOf`, mirroring `guardrails.e2e.test.ts:20-25` and `memory.e2e.test.ts:26-31`. No new helper added to `helpers.ts`.
- **Deterministic thread id:** passed via the standard `{ configurable: { thread_id } }` second argument to `agent.invoke`. Not strictly required for a single-shot run but mirrors what `runtime.test.ts` does and keeps the test ready for a future multi-turn `waiting_for_user` extension.
- **Debug aid:** `console.log(result)` on the line before assertions, matching `review.e2e.test.ts:53` and `subagents.e2e.test.ts:49`.
- **Timeout:** `180_000` ms (3 minutes). The full happy path is roughly 6–10 model round trips: clarifier delegation, supervisor `workflow_complete_execution` call, product-generator delegation, review-agent delegation, plus controller nudge turns injected by `afterModel`. Three minutes gives headroom for slow model responses without being so long it masks a hang.

## Testing Decisions

**What makes a good test here.** Assert only on externally observable behavior — the contents of the agent's returned transcript — never on the middleware's internal state map. The workflow controller's internals (`states`, `getWorkflowState`) are deliberately not exposed by `createScaffoldedAgent`, and the test should not require exposing them. Transcript markers are the contract the middleware actually enforces on the model.

**Module under test.** `packages/core/src/workflow/runtime.ts` (`createWorkflowControllerMiddleware`) as wired by `packages/core/src/agent/scaffolded.ts`, exercised through the real DeepAgent it produces.

**Prior art in the codebase.**

- `review.e2e.test.ts` — same `describe.skipIf` gate, same `createScaffoldedAgent` shape, same `findToolMessage(msgs, "task")` pattern for inspecting `task` tool outputs.
- `subagents.e2e.test.ts` — proves the clarifier delegation works through the scaffolded agent.
- `generative-ui.e2e.test.ts` — proves the product-generator delegation works and that `generativeUi: {}` is the right knob to enable that subagent.
- `guardrails.e2e.test.ts` and `memory.e2e.test.ts` — supply the `stringifyMessageContent` / `transcriptOf` helper pattern this test reuses for transcript assertions.
- `runtime.test.ts` — defines the unit-level contract this e2e complements; in particular `runtime.test.ts:49-107` ("continues readiness through execution, product generation, and review") is the unit-level twin of this e2e.

**Specific assertions (all on the transcript string).**

1. The transcript contains the literal `WORKFLOW_CONTROLLER_FEEDBACK` at least once — proves the controller intervened to keep the supervisor on-rails.
2. The transcript contains the canonical required-subagent markers in the controller's feedback envelope (`requiredSubagent=clarifier`, `requiredSubagent=product-generator`, and `requiredSubagent=review-agent`) and asserts their order by first-occurrence index. This proves the controller forced the canonical sequence rather than letting the supervisor finalize early.
3. The transcript does **not** contain `phase=error` nor `controller_retry_exhausted` — proves the run never hit the terminal failure path in the reducer.
4. At least one `task` tool message exists for each of the three subagent types, confirmed by scanning `result.messages` for tool messages whose `name === "task"` and whose content/args indicate the relevant `subagent_type`. This cross-checks the controller's required-subagent directive against actual delegation.
5. The final non-tool message in the transcript is a non-empty assistant string that does **not** start with `WORKFLOW_CONTROLLER_FEEDBACK` — proves the supervisor actually delivered a real answer rather than ending on a controller nudge.

**What the test deliberately does not assert.** Exact phase counts, exact turn counts, exact wording of the delivered answer, or any specific review score — these are all model-nondeterministic and would make the test flake.

## Out of Scope

- **Revision loop.** Forcing the reviewer to report `changes_required` once and then approve. Adds ~3 more model calls and meaningful flake; covered separately by a follow-up e2e.
- **`waiting_for_user` round trip.** A multi-turn `invoke` exercising the `clarification → waiting_for_user → clarification` cycle. Requires interrupt handling and a second user reply; deferred.
- **Store persistence across middleware instances.** Already covered by `runtime.test.ts:109-131` ("restores workflow state from the store without leaking between threads"). No live-model equivalent needed.
- **Generative UI **off** path.** The test exercises the `generativeUiEnabled: true` route because that is the superset of phases. The `generativeUiEnabled: false` route (straight `execution → review`) is already covered by the unit test pair `reducer.test.ts` + `runtime.test.ts`.
- **Production code changes.** No exports added, no `getWorkflowState` accessor exposed, no new helpers in `./helpers.ts`.

## Further Notes

- This e2e complements — does not replace — `runtime.test.ts` and `reducer.test.ts`. The unit tests pin the deterministic state-machine contract; this e2e proves the production wiring drives a real model through that contract end to end.
- The prompt is intentionally narrow. A simple, scoped task minimizes the chance that the clarifier returns `needs_clarification` (which would push the run into the out-of-scope `waiting_for_user` path) and minimizes the chance that the reviewer reports `changes_required` (which would push the run into the out-of-scope revision loop).
- The narrow prompt should lead the clarifier to return `ready_to_proceed` in its first round. The test pins the downstream ordering invariant (product-generator before review-agent) and the absence of `phase=error`.
- If the live model becomes flaky at this scope, the first remediation is to raise the timeout, not to weaken the assertions. The phase-marker assertions are the value of the test and should not be loosened.
- Run command is unchanged: `bun run --filter deepagents-core test:e2e` (defined in `packages/core/package.json:8`) loads `.env`, sets `RUN_LIVE_E2E=1`, and picks up the new `e2e/*.e2e.test.ts` file automatically by glob.
