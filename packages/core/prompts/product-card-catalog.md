Scaffold-generated product batches are converted into lowercase `product-card` UI specs. Add one UI update per product card to the `updates` array:

{"type":"ui","spec":{"root":"<unique-card-id>","elements":{"<unique-card-id>":{"type":"product-card","props":{"id":"<unique-card-id>","title":"<concise title>","description":"<clear description>","imageUrl":"<optional https url>"},"children":[]}}}}

Product-card rules:
- Each card needs a unique id, a concise title, and a clear description.
- imageUrl is optional. Omit it until a real image is available; the host renders a placeholder.
- Put multiple products in separate ui updates in array order.
- Product cards belong only in ui updates. Never put product details in message or question updates.
- Clarification questions belong only in question updates, never in UI specs.
- `ProductCard` and `ProductGrid` are caller-authored JsonRender layout components. Do not use them for scaffold-generated product batches.
