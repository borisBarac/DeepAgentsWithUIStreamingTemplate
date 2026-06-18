## Problem Statement

The orchestrated Deep Agent graph currently includes debate-style workflow support even though the product direction is to disable debates entirely. Debate routing, debate state, the `judge` stage, and debate-specific documentation add branching, terminology, and tests that no longer serve the intended user experience. This leaves users and implementers with an unnecessary workflow shape to reason about, increases maintenance cost, and makes the orchestration contract less clear than it needs to be.

## Solution

Remove debate-style workflow support from the orchestrated Deep Agent system so that the supported productive stages are limited to clarification, research, coding, finalization, and review. Debate-triggered routing should be disabled, debate-specific state and result handling should be removed, the `judge` stage should no longer participate in orchestration, and the surrounding docs and tests should describe only the supported graph contract. The result should be a simpler deterministic orchestration surface with fewer routes, fewer stage outputs, and no debate-only role or node behavior.

## User Stories

1. As an application developer, I want the orchestrated graph to expose only supported workflow stages, so that I do not have to reason about unused debate behavior.
2. As an application developer, I want task routing to ignore debate-oriented wording, so that prompts containing comparison language do not trigger a hidden workflow branch.
3. As an application developer, I want `createOrchestratedDeepAgentGraph(...)` to have a smaller routing surface, so that configuration is easier to understand and test.
4. As an application developer, I want the routing options to exclude debate toggles, so that the public API matches the intended product direction.
5. As an application developer, I want graph state to exclude debate-only result fields, so that persisted state and snapshots reflect only supported stages.
6. As an application developer, I want orchestration routes to exclude debate-specific values, so that downstream consumers can switch over a smaller and more stable route set.
7. As an application developer, I want the orchestration graph to skip any debate or judgment node, so that stage transitions remain deterministic and minimal.
8. As an application developer, I want the finalizer context packet to exclude debate output and judgment output, so that final answer synthesis depends only on supported stage results.
9. As an application developer, I want the reviewer context packet to exclude debate-specific sections, so that review input stays aligned with the supported workflow.
10. As a maintainer, I want the runtime role catalog to exclude debate-only responsibilities if they are no longer reachable, so that model assignments do not advertise unsupported roles.
11. As a maintainer, I want orchestration tests to fail if debate routing or judge-stage behavior reappears, so that the simplified contract stays enforced over time.
12. As a maintainer, I want documentation to describe only supported productive stages, so that new contributors do not build against deprecated workflow shapes.
13. As a maintainer, I want ADRs and glossary material to stop presenting debate as active scope, so that architectural records do not conflict with implementation intent.
14. As a maintainer, I want exported package surfaces to stop exposing debate-only orchestration concepts where possible, so that consumers are guided toward the supported contract.
15. As an evaluator, I want route-selection tests to assert research, code, final-only, and blocked behavior without debate branches, so that the highest public seam remains easy to verify.
16. As an evaluator, I want orchestration graph tests to assert end-to-end behavior without debate setup, so that coverage reflects the real product surface.
17. As a user of a host application built on this repo, I want ambiguous requests like "compare options" to stay within the normal research or coding flow, so that I get predictable behavior.
18. As a user of a host application built on this repo, I want the system to avoid inventing adjudication stages, so that responses come from the supported workflow only.
19. As a product owner, I want the orchestrated Deep Agent contract to align with the current roadmap rather than deferred debate experiments, so that planning and implementation stay focused.
20. As a future contributor, I want any reintroduction of debate to require a deliberate new PRD and API decision, so that the simpler baseline is not eroded accidentally.

## Implementation Decisions

- The supported productive stages will be clarification, research, code, finalization, review, blocked delivery, and end-state termination. Debate is removed as a productive stage.
- The deterministic routing policy will no longer include debate keyword detection or a debate feature flag. Route selection should continue to prioritize explicit, inspectable rules for research, coding, and direct finalization.
- The orchestration route contract will be narrowed by removing debate-specific route values. Any public type, state transition helper, or graph edge helper should reflect the reduced route set.
- The orchestration state contract will remove debate-only result storage. State snapshots should retain only supported stage outputs such as research results, code results, final answer, review state, and structured errors.
- The graph will no longer construct or invoke a `judge` node as part of orchestration. If the runtime still supports a generic `judge` model role for unrelated future uses, that role must be clearly decoupled from the orchestration graph; otherwise it should be removed from the supported role catalog.
- The graph factory options will remove debate-specific configuration from the routing block. Consumers should not be able to enable a workflow that the implementation no longer supports.
- Finalizer input assembly will drop debate and judgment sections so the finalization contract reflects only the surviving stages.
- Reviewer input assembly will drop debate and judgment sections so the review packet remains bounded to supported context.
- Any internal helper that currently treats debate as an alias for `judge` should be simplified to route only to the remaining stage nodes.
- Public exports, README material, PRDs, ADRs, and glossary entries that describe debate as part of the active orchestration surface should be updated or explicitly marked historical. The intended outcome is that active documentation no longer presents debate as a supported path.
- The implementation should prefer deleting unreachable debate logic over leaving dead flags, placeholder enums, or no-op branches behind. The contract should become structurally simpler, not just behaviorally disabled.
- The removal should preserve the existing orchestration boundary decisions that still apply: StateGraph remains the optional outer controller, routing remains deterministic, and finalization remains deterministic by default unless explicitly overridden.

## Testing Decisions

- Good tests should assert externally visible orchestration behavior and public contracts rather than implementation details such as internal variable names or incidental helper structure.
- The highest preferred seam is deterministic route selection through the existing route-selection entrypoint. Tests should prove that debate-oriented text no longer selects a distinct debate path and instead falls through to the remaining supported routes according to configuration.
- The next preferred seam is end-to-end orchestration graph behavior through the existing graph factory and stage invocation tests. Tests should verify that no debate or judge stage is reachable, no debate output is carried into finalization or review, and the remaining stages still behave correctly.
- Type-level and export-surface assertions should cover the narrowed route, state, and configuration contracts where the codebase already treats those as public API.
- Existing orchestration tests are the primary prior art, especially the route-selection tests and the graph execution tests around stage transitions, finalizer inputs, and reviewer inputs.
- Documentation-adjacent changes do not require brittle snapshot tests. Instead, code tests should enforce the real contract, and docs should be reviewed for consistency as part of the implementation.

## Out of Scope

- Introducing a replacement multi-position reasoning workflow.
- Redesigning research or coding prompts beyond the changes required to remove debate references.
- Reworking the broader Deep Agents runtime outside of debate-related orchestration and role exposure.
- Adding a new model-backed router or any non-deterministic routing policy.
- Changing review gate semantics unrelated to the removal of debate context.
- Introducing persistence or checkpointing changes unrelated to the narrowed state shape.

## Further Notes

- This work should treat debate support as removal, not deprecation. The goal is to simplify the active contract, not to leave dormant toggles in place.
- The main seams assumed for implementation and verification are `selectWorkRoute(...)` and `createOrchestratedDeepAgentGraph(...)`, plus the existing finalizer and reviewer input assertions that already validate state-to-message behavior at a high level.
- If any historical architecture document must keep debate for recordkeeping, it should be clearly framed as historical context rather than current supported behavior.
- Tracker issue: `DeepAgentTemplate-xrw`
