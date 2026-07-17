# E2E: Unsupported Catalog Schema Repair

## Summary

Add a live-LLM end-to-end test that exercises the unsupported-catalog-schema handling path end to end: a live agent emits a UI spec using a component type that is not in the core catalog, the interaction stream's repair loop rejects it with structured `unknown_component` feedback, asks the agent to repair once, and either accepts the repaired catalog-compliant spec or falls back to the fixed safe `message`.

This complements the unit coverage in `packages/core/src/generative-ui/contract.test.ts` and `packages/core/src/interaction-stream/index.test.ts` (both driven by `FakeAgent`) with a single live-model test that proves the rejection → repair → fallback pipeline works against a real LLM through the same wiring the web app uses.

## Scope and trigger

- Targeted code path:
  - `validateStreamingSpec` / `diagnoseElement` → `unknown_component` issue with path `elements.<key>.type` (`packages/core/src/generative-ui/contract.ts:160`, `:229`).
  - `runInteraction` repair loop (`packages/core/src/interaction-stream/index.ts:189`) → `buildRepairFeedback` (`:296`) → one retry → `UNRENDERABLE_UI_MESSAGE` fallback (`:76`).
- Trigger strategy (explicit instruction): the user prompt directs the agent to emit its **first** `ui` NDJSON line using a component type that is deliberately absent from the core catalog (e.g. `"Carousel"`). The core `catalogPrompt` advertises only `Button, Card, ImagePlaceholder, ProductCard, ProductGrid, Stack, Text, TextInput, product-card`, so the off-catalog type is guaranteed to reach `diagnoseElement`.

## New file

`packages/core/e2e/generative-ui-unsupported-schema.e2e.test.ts`

## Source change required

Export the safe-fallback constant so the test can assert identity instead of substring-coupling:

- `packages/core/src/interaction-stream/index.ts:76` — export `UNRENDERABLE_UI_MESSAGE` (currently a private `const`).
- Re-export it from `packages/core/src/index.ts` if that barrel surfaces interaction-stream symbols.

No other production behavior changes.

## Test structure

- `describe.skipIf(!hasLiveLLMCredentials)(...)` — same gate as the existing `generative-ui.e2e.test.ts`. Runs only under `RUN_LIVE_E2E=1` with live credentials.
- Live runtime via `createDefaultModelRuntime(false)` from `./helpers.ts`.
- Live agent built exactly as the web app wires it (`packages/web-app/app/api/agent/route.ts:108` reference):
  ```ts
  const agent = createScaffoldedAgent({
    modelRuntime,
    guardrails: false,
    generativeUi: { catalogPrompt }, // core-owned catalog
  });
  ```
- Recording proxy (local helper in the test file) implementing `StreamableAgent` by forwarding `streamEvents` / `invoke` to the real agent while capturing each call's `input.messages` into `invocations: AgentInputMessage[][]`. This is the observation point for the repair feedback; no production code is touched.
- Interaction stream wiring:
  ```ts
  const interaction = createInteractionStream({
    agent: proxy,
    messages: [{ role: "user", content: USER_PROMPT }],
    sessionId: `unsupported-schema-${crypto.randomUUID()}`,
    validateSpec: validateStreamingSpec,
  });
  const updates: UiUpdate[] = [];
  for await (const u of interaction.updates) updates.push(u);
  await interaction.result;
  ```

## Acceptance tests

- **No-leak invariant (always):** every emitted `ui` update's spec passes `validateStreamingSpec` with `ok: true`. No unsupported schema ever reaches a renderer.
- **Termination invariant (always):** the stream emits at least one `ui` or `message` update within the timeout; it does not hang or crash.
- **Repair-path assertion (conditional, primary signal):** if the proxy recorded more than one invocation (a repair round occurred), the second invocation's last `user` message contains both `unknown_component` and a path prefixed `elements.` — confirming `diagnoseElement` produced the structured issue and `buildRepairFeedback` encoded it. This is the expected branch given the explicit off-catalog instruction.
- **Fallback-identity assertion (conditional):** if no `ui` update was emitted, a `message` update was emitted with `text` equal to the exported `UNRENDERABLE_UI_MESSAGE` — confirming the terminal fallback for an unrepairable off-catalog spec.
- Timeout: `180_000` ms (two LLM round trips are possible).

## Why this design

- It reuses the exact wiring production uses (web-app route), so it e2e-tests the real rejection → repair → fallback pipeline driven by a live model.
- It targets the precise code that handles unsupported schemas: `diagnoseElement`'s `unknown_component` issue flowing through `buildRepairFeedback` into a second agent turn.
- Invariant-based assertions keep the test green under model nondeterminism; the conditional assertions give a strong signal when the model complies with the off-catalog instruction (the expected case).

## Assumptions

- A single repair attempt is sufficient coverage (matches production: one retry, then fallback).
- The live model is expected to comply with the explicit off-catalog instruction on the first attempt; if it instead self-corrects to a catalog component immediately, the repair-path assertion is skipped and only the no-leak + termination invariants run. The test stays green either way.
- The off-catalog component name (`Carousel`) is illustrative; any name absent from `componentTypes` works.
- Existing unit tests already cover the deterministic rejection/repair behavior with `FakeAgent`; this live test does not replace them.

## Run command

`bun run test:e2e` (defined in `packages/core/package.json:8`) loads `.env`, sets `RUN_LIVE_E2E=1`, and picks up the new `e2e/*.e2e.test.ts` file automatically.
