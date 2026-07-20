# UI catalogue

The web app renders generated UI from a fixed A2UI catalogue. The model may emit only catalogue components; it cannot emit arbitrary React, HTML, or JavaScript.

## Sources of truth

- `packages/core/catalog/catalog.json` defines component names, prop JSON Schemas, and payload limits. The server validator and model-facing catalogue prompt are generated from it.
- `packages/core/schemas/envelope.json` defines the catalogue-agnostic update envelope and flat component wire shape.
- `packages/web-app/src/ui/catalog.tsx` provides the React renderers. Its Zod records are intentionally permissive and are not a second prop contract.
- `packages/web-app/src/ui/schema-contract.test.tsx` guards catalogue-to-renderer coverage.

## Wire shape

A `type: "ui"` update carries a flat `components` array and an optional `rootId`:

```json
{
  "type": "ui",
  "rootId": "layout",
  "components": [
    {
      "id": "layout",
      "component": "Stack",
      "direction": "column",
      "children": ["heading", "product-1"]
    },
    {
      "id": "heading",
      "component": "Text",
      "text": "Recommended products",
      "variant": "title"
    },
    {
      "id": "product-1",
      "component": "ProductCard",
      "title": "Launch Map",
      "description": "A planning workspace."
    }
  ]
}
```

Each `ComponentInstance` has structural fields `id`, `component`, and optional `children`; component props are the remaining top-level fields. `id` identifies the instance and is not a `ProductCard` prop. IDs must be unique. Child IDs must resolve, the graph must be acyclic, and every component must be reachable from `rootId` (or the first component when `rootId` is omitted).

The wire format does not use json-render's `{ root, elements }` shape. `packages/web-app/src/ui/spec-adapter.ts` performs that conversion only at the renderer boundary, keeping json-render details out of the protocol.

## Runtime flow

1. The agent prompt receives component names and prop descriptions generated from `catalog.json`.
2. The model emits updates as NDJSON using the flat wire shape.
3. The interaction stream and API route pass server-bound updates through `safeEmit(..., { strict: true })` before encoding them.
4. The server validator uses Ajv 2020-12 for the envelope and catalogue prop schemas, then checks payload limits and graph integrity. Invalid updates never reach the wire.
5. The browser parses each line with the hand-rolled validator in `packages/web-app/src/ui/validate-spec.ts`. This avoids shipping Ajv while independently enforcing the envelope, catalogue props, limits, and graph rules.
6. Accepted UI updates are adapted to `{ root, elements }` and passed to the fixed React registry.

The old contract-based validator, nested spec contract, product batch, and product-generator path were deleted. There is one current model-to-UI path: catalogue-backed flat A2UI updates through strict validation and `safeEmit`.

## Supported components

| Component | Purpose | Props |
| --- | --- | --- |
| `Button` | Runs a local UI action. | `label`, optional `action` |
| `Card` | Groups child content in a bordered container. | Optional `title` |
| `ImagePlaceholder` | Shows an image description until an image exists. | Optional `alt`, optional `prompt` |
| `ProductCard` | Shows a product in a model-authored layout. | `title`, `description`, optional `imagePrompt` |
| `ProductGrid` | Lays out one or more product cards. | Optional `heading` |
| `Stack` | Lays out children in a row or column. | Optional `direction`, optional `gap` |
| `Text` | Shows text with a fixed visual style. | `text`, optional `variant` |
| `TextInput` | Stores a text, email, or password value in form data. | `label`, `name`, optional `placeholder`, optional `inputType` |

The agent is a product design system: successful delivery always renders one `ProductGrid` containing only reviewed `ProductCard` components.

`Stack.direction` accepts `row` or `column`. `Stack.gap` accepts `xs`, `sm`, `md`, or `lg`. `Text.variant` accepts `title`, `body`, `muted`, or `caption`. `TextInput.inputType` accepts `text`, `email`, or `password`.

## Supported actions

The preview registers two local actions:

| Action | Result |
| --- | --- |
| `demo_action` | Shows `Demo action ran.` |
| `submit_demo` | Shows `Demo submitted.` |

These actions only update preview feedback. They do not call an API or save form data. An unknown action reports that it is not wired.

## Validation rules

Updates are rejected for malformed envelopes, unknown components, missing or invalid props, unknown props, duplicate IDs, missing roots or children, self-references, cycles, unreachable components, non-serializable data, more than 100 components, strings longer than 4,096 characters, or JSON payloads larger than 128 KiB.

Qualification questions remain `question` updates; component trees remain `ui` updates.

## Adding a component

1. Add its prop JSON Schema under `components` in `packages/core/catalog/catalog.json`. Do not include structural `id`, `component`, or `children` as props.
2. Add its description, local TypeScript prop type, and renderer in `packages/web-app/src/ui/catalog.tsx`. Keep the Zod entry permissive; `catalog.json` owns runtime prop validation.
3. Add a valid sample and coverage in `packages/web-app/src/ui/schema-contract.test.tsx`, plus focused renderer behavior tests when needed.
4. If the prop schema introduces a JSON Schema feature not handled by the browser mini-validator, extend `packages/web-app/src/ui/validate-spec.ts` and its parity fixtures.
5. Run `bun test`, `bun run typecheck`, `bun run check`, and `bun run --filter @deep-agent-template/web-app build`.

The prompt and server component validator update automatically from `catalog.json`; do not maintain another prop schema or hand-written prompt component list.
