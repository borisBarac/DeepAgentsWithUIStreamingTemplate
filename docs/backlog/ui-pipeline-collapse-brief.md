# UI pipeline collapse: implemented architecture record

> **Status:** Implemented on 2026-07-18 as the clean-break A2UI architecture.
>
> **Source:** Architecture review 2026-07-18, candidate #c2. The shipped design resolved the underlying duplication by replacing the legacy paths rather than consolidating them into the originally proposed deep module.

## Outcome

The UI pipeline now has explicit, narrow ownership:

- `packages/core/catalog/catalog.json` is the source of truth for component names, prop JSON Schemas, and limits.
- `packages/core/schemas/envelope.json` owns the catalogue-agnostic update envelope.
- UI updates use a flat `ComponentInstance[]` wire format: structural `id`, `component`, optional `children`, and top-level component props.
- Structural `id` identifies a component instance. It is not a `ProductCard` prop.
- The model-facing catalogue text is generated from `catalog.json`.
- The server compiles the envelope and component schemas with Ajv 2020-12, applies payload and graph checks, and routes emits through strict `safeEmit`.
- The browser uses a hand-rolled validator to avoid bundling Ajv while checking the same envelope, catalogue props, limits, and graph invariants.
- Only the renderer adapter converts accepted instances to json-render's `{ root, elements }` format.

The legacy contract validator, nested json-render wire contract, product batch, and product-generator route were deleted. They are not extension points.

## Rationale retained

The review correctly identified schema drift, repeated parsing, validation fan-out, and several error shapes for one logical update. The clean break addresses those risks with:

- one data catalogue instead of parallel prop definitions
- one flat protocol independent of the rendering library
- one strict server validation and emit boundary
- a small browser-side safety boundary
- catalogue-derived prompt text
- contract tests that keep catalogue entries and React renderers aligned

This preserves the useful goal of locality without creating a large all-purpose pipeline module. Protocol, catalogue, validation, emission, browser safety, and rendering adaptation remain separate by responsibility.

## Current flow

1. `catalog.json` generates the prompt's component catalogue.
2. The model emits flat A2UI updates as NDJSON.
3. The server validates envelope shape, per-component props, size limits, unique IDs, child references, cycles, and reachability.
4. `safeEmit(..., { strict: true })` is the only server emit chokepoint; rejected updates do not reach the wire.
5. The client mini-validator rejects malformed or unsafe lines before state updates.
6. `packages/web-app/src/ui/spec-adapter.ts` converts accepted UI updates to `{ root, elements }` immediately before rendering.

## Current extension workflow

1. Add or change the component prop schema in `packages/core/catalog/catalog.json`.
2. Add or change the React description, local prop type, and renderer in `packages/web-app/src/ui/catalog.tsx`.
3. Update the valid sample and bidirectional catalogue/registry checks in `packages/web-app/src/ui/schema-contract.test.tsx`.
4. Extend the hand-rolled client validator only when using a JSON Schema feature it does not yet implement; add server/client parity fixtures.
5. Keep `id`, `component`, and `children` structural. Do not add renderer-library shapes to the wire protocol.
6. Run the repository quality gates.

## Verification

```bash
bun test
bun run typecheck
bun run check
bun run --filter @deep-agent-template/web-app build
```

No migration phases remain. Future work should extend the current catalogue-backed path rather than restore deleted compatibility surfaces.
