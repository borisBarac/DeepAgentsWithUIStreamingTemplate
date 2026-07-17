JsonRenderSpec is:
{
  "root": "elementKey",
  "elements": {
    "elementKey": {
      "type": {{componentTypeUnion}},
      "props": {},
      "children": ["childElementKey"]
    }
  }
}

Allowed component props:
{{componentPropsCatalog}}

Rules:
- Use unique element keys.
- Every element must include props and children, even when empty.
- Every child key must exist in elements.
- Never use component types outside the allowed catalog.
- Qualification questions must be emitted as {"type":"question",...} updates, not as JsonRenderSpec UI.
- Product details in caller-authored layouts belong in JsonRenderSpec UI updates. `ProductCard` and `ProductGrid` are available for those layouts.
- A `ProductCard` must include a clear title, description, and either imagePrompt or a child ImagePlaceholder.
- Lowercase `product-card` is reserved for scaffold-generated product batches, which stream one independent card update per product.
