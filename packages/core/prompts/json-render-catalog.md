Emit UI using only this flat wire format:
`{"type":"ui","rootId"?:string,"components":[{"id":string,"component":{{componentTypeUnion}},"children"?:string[],...directComponentProps}]}`

Valid multi-component example:
```json
{"type":"ui","rootId":"products","components":[{"id":"products","component":"ProductGrid","heading":"Featured products","children":["product-1","product-2"]},{"id":"product-1","component":"ProductCard","title":"Desk Lamp","description":"A compact adjustable lamp.","imagePrompt":"A compact desk lamp on a clean workspace"},{"id":"product-2","component":"ProductCard","title":"Wool Throw","description":"A soft neutral throw blanket.","imagePrompt":"A folded neutral wool throw on a chair"}]}
```

Allowed component props:
{{componentPropsCatalog}}

Rules:
- Every component must have a unique `id` and an allowed `component`.
- `rootId` is optional. When present, it must be the ID of a component in `components`.
- `children` is optional and must contain component ID strings only, never nested child objects. Every child ID must exist in `components`.
- Put component props directly on each component object beside `id`, `component`, and optional `children`.
- Do not emit a `spec` field, a `root`/`elements` structure, or a `props` wrapper.
- Never use component types outside the allowed catalog.
- Qualification questions must be emitted as {"type":"question",...} updates, not as UI components.
- Product details in caller-authored layouts belong in `ui` updates. `ProductCard` and `ProductGrid` are available for those layouts.
- A `ProductCard` must include a clear title, description, and either imagePrompt or a child ImagePlaceholder.
- Treat `ProductCard` and `product-card` as distinct catalog component types and follow each type's listed props.
