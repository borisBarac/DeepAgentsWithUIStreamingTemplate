# UI catalogue

The web app uses a fixed catalogue for generated UI. The model returns a JSON tree made from approved components. It cannot return arbitrary React, HTML, or JavaScript.

## How it works

The catalogue contract lives in `packages/core/src/generative-ui/contract.ts`. Core owns the component names, prop schemas, limits, validation, and the catalogue text added to the model prompt.

The flow is:

1. `packages/web-app/src/server/agent-provider.ts` passes the core catalogue prompt to the scaffolded agent.
2. The model returns a `ui` update containing a `JsonRenderSpec` with one root and a map of keyed elements.
3. `packages/web-app/app/api/agent/route.ts` validates each specification before streaming it to the browser.
4. `packages/web-app/src/ui/catalog.tsx` maps each accepted component name to a fixed React component.
5. `JsonRenderPreview` renders the accepted specification in the preview pane.

Invalid specifications do not reach the renderer. Validation returns errors with a code and JSON path so the interaction stream can ask the model to repair its output.

## Supported components

| Component | Purpose | Props |
| --- | --- | --- |
| `Button` | Runs a local UI action. | `label`, optional `action` |
| `Card` | Groups child content in a bordered container. | Optional `title` |
| `ImagePlaceholder` | Shows an image description until an image exists. | Optional `alt`, optional `prompt` |
| `ProductCard` | Shows a product inside a model-authored layout. | `title`, `description`, optional `imageAlt`, optional `imagePrompt` |
| `ProductGrid` | Lays out one or more product cards. | Optional `heading` |
| `Stack` | Lays out children in a row or column. | Optional `direction`, optional `gap` |
| `Text` | Shows text with a fixed visual style. | `text`, optional `variant` |
| `TextInput` | Stores a text, email, or password value in form data. | `label`, `name`, optional `placeholder`, optional `inputType` |
| `product-card` | Shows one scaffold-generated product result. | `id`, `title`, `description`, optional `imageUrl`, optional `status` |

`Stack.direction` accepts `row` or `column`. `Stack.gap` accepts `xs`, `sm`, `md`, or `lg`. `Text.variant` accepts `title`, `body`, `muted`, or `caption`. `TextInput.inputType` accepts `text`, `email`, or `password`.

## Product card types

The two product card names serve different output paths.

`ProductCard` belongs in model-authored layouts. The model can place it under `ProductGrid` and add child components.

Lowercase `product-card` is reserved for the product generator scaffold. Each product is sent as a separate `ui` update. The component can show a generated image URL or a placeholder while the image is pending.

## Supported actions

The preview registers two local actions:

| Action | Result |
| --- | --- |
| `demo_action` | Shows `Demo action ran.` |
| `submit_demo` | Shows `Demo submitted.` |

These actions only update preview feedback. They do not call an API or save form data. An unknown action shows that the action is not wired yet.

## Validation rules

The server rejects a specification when it has:

- A component outside the catalogue.
- Missing or invalid props.
- A missing root or elements map.
- A child key that does not exist.
- A cycle in the element tree.
- An element that cannot be reached from the root.
- More than 100 elements.
- A string longer than 4,096 characters.
- A JSON payload larger than 128 KiB.

Qualification questions use `question` updates and do not belong in UI specifications. Product details use `ui` updates and do not belong in message or question updates.

## Adding a component

Update all of these places:

1. Add the component name and Zod prop schema in `packages/core/src/generative-ui/contract.ts`.
2. Add its catalogue description in `packages/web-app/src/ui/catalog.tsx`.
3. Add its React renderer to the registry in the same file.
4. Update the contract and rendering tests.

The core catalogue prompt is generated from the core component list and prop schemas. Do not maintain a second hand-written component list in a prompt.
