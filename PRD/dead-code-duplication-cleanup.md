# Dead Code and Duplication Cleanup PRD

## Problem Statement

The repo has a small but real accumulation of dead code and duplicated logic across `packages/core`, `packages/image-gen`, and `packages/web-app`. The dead code increases surface area, makes exports harder to trust, and leaves a few public-looking symbols with no callers. The duplication increases drift risk, especially where prompt text, helper branches, and small utility functions have already diverged.

The current audit identified these concrete issues:

- Dead or effectively unused exports in `packages/core/src`, `packages/image-gen/src`, and `packages/web-app/src`.
- Duplicate helper logic in `packages/core/src/memory`, `packages/image-gen/src`, and `packages/web-app/src/ui/use-agent-chat.ts`.
- A split source of truth in `packages/core/src/generative-ui/contract.ts` where the component contract is encoded both as schemas and as prompt text.

## Solution

Remove confirmed dead code first, then consolidate the duplicated helpers and contract definitions into smaller shared seams. Prefer the smallest correct refactor: delete unused symbols where possible, and extract a private helper only when two call sites still need the same logic.

The cleanup should preserve runtime behavior, keep the public package surfaces stable where they are already consumed, and add tests that lock in the slimmer contract.

## Goals

1. Remove confirmed dead exports and dead modules.
2. Eliminate the duplicate `stringOrFallback` helper.
3. Reduce the repeated assistant-message update logic in `use-agent-chat.ts`.
4. Make the generative-UI component contract a single source of truth.
5. Collapse image-generation provider selection into one shared branch.
6. Keep behavior unchanged for existing callers.
7. Add tests that fail if the dead exports or duplicate paths reappear.

## Non-Goals

1. Large-scale architectural rewrites.
2. Public API redesign beyond removing unused exports.
3. Changing user-visible behavior in the web app or CLI.
4. Reworking unrelated test helpers or package boundaries.

## Implementation Plan

### Phase 1: Remove dead code

- Delete `packages/web-app/src/ui/use-agent-chat.ts:120-126` `appendSubagentActivity` if no production caller is added.
- Remove `packages/image-gen/src/providers/factory.ts` if the factory is only test-used, or inline its logic into the remaining provider path and update tests accordingly.
- Remove unused public exports in `packages/core/src/review/state.ts`, `packages/core/src/guardrails/safety.ts`, `packages/core/src/guardrails/task-scope.ts`, and `packages/image-gen/src/types/results.ts` if no in-repo caller remains.
- Re-check barrel exports in `packages/core/src/*/index.ts` and `packages/image-gen/src/index.ts` so only live symbols remain.

### Phase 2: Collapse duplication

- Extract the repeated `stringOrFallback` helper in `packages/core/src/memory` into one local utility or inline it once.
- Refactor `packages/web-app/src/ui/use-agent-chat.ts` so assistant message append and replace share one small updater.
- Refactor `packages/image-gen/src/from-env.ts` and `packages/image-gen/src/providers/factory.ts` so fake-vs-replicate provider selection lives in one place.
- Replace the hand-written `catalogPrompt` block in `packages/core/src/generative-ui/contract.ts` with prompt text derived from the same component metadata that defines the schemas, or generate it from one canonical structure.

### Phase 3: Verify contract cleanup

- Remove any now-unused tests that only exercised deleted dead code.
- Update tests that should now cover the shared helper seams instead of copy-pasted branches.
- Re-run typecheck and package tests.

## Testing Decisions

- Prefer unit tests at the smallest seam that changed.
- Add assertions that removed symbols are not exported from package barrels if those barrels are part of the supported API.
- Add regression tests for the refactored helpers rather than snapshotting whole files.
- Run `bun test` and `bun run typecheck` after the cleanup.

## Acceptance Criteria

1. The confirmed dead exports are removed or intentionally reclassified as supported API with an in-repo caller.
2. The duplicated `stringOrFallback` helper exists only once.
3. `use-agent-chat.ts` no longer has two near-identical assistant update branches.
4. `catalogPrompt` and the component schemas no longer drift independently.
5. Image-generation provider selection has one canonical implementation path.
6. Typecheck and tests pass.

## Out of Scope

- Broader package reshaping.
- New features.
- Changing prompt semantics beyond keeping the contract synchronized.
- New runtime abstractions just to avoid a single helper duplication.

## Further Notes

- The highest-risk item is the generative-UI contract prompt. Treat it as the canonical user-facing contract and keep its schema/prompt coupling explicit.
- The dead-code list should be re-verified before deletion, especially for exported symbols that only appear in barrels.
- If any item turns out to be externally required, keep it and document why it remains public.
- Tracker issue: `DeepAgentTemplate-el6`
