# Connecting A2UI in React

This note is based on the A2UI `restaurant_finder` sample, especially:

- Flutter client: `samples/client/flutter/restaurant_finder`
- React shell: `samples/client/react/shell`
- Agent sample: `samples/agent/adk/restaurant_finder`

The goal here is not to copy the Flutter UI. The goal is to copy the integration pattern and translate it into React.

## What the sample is actually doing

The `restaurant_finder` demo has four moving parts:

1. The agent returns A2UI messages over A2A.
2. The client declares which catalog(s) it can render.
3. The client processes streamed A2UI messages into local surface state.
4. User actions from rendered components are sent back to the agent as A2UI client messages.

In Flutter, this is handled by:

- `A2uiAgentConnector`
- `SurfaceController`
- `surfaceController.onSubmit`

In React, the equivalent shape is:

- a transport client that talks to your backend or A2A proxy
- `MessageProcessor` from `@a2ui/web_core/v0_9`
- `A2uiSurface` from `@a2ui/react/v0_9`
- an action handler that turns UI events back into A2UI client messages

## The protocol flow

For the restaurant sample, the normal lifecycle is:

1. User sends text like "Find me 3 Chinese restaurants in New York."
2. Agent responds with A2UI v0.9 messages:
   - `createSurface`
   - `updateComponents`
   - `updateDataModel`
3. React processes those messages and renders a surface.
4. User clicks a button like `Book Now`.
5. The renderer emits a client action payload with resolved context.
6. The client sends that payload back to the agent.
7. The agent responds with a new surface, such as the booking form or confirmation card.

This is the key idea: A2UI is not "React components over the wire". It is a stream of declarative UI messages that React renders locally through a trusted catalog.

## The React architecture to use

Use this shape in our app:

```text
React page
  -> A2UI transport client
  -> MessageProcessor([catalogs], actionHandler)
  -> A2uiSurface for each active surface
  -> send action payloads back to agent
```

That maps directly to the sample:

- Flutter `RestaurantSession` ~= React `useA2uiSession` or page-level controller
- Flutter `SurfaceController` ~= `MessageProcessor`
- Flutter `Surface(...)` widget ~= `A2uiSurface`
- Flutter connector stream ~= SSE or JSON transport in the React client

## Recommended packages

For the direct React renderer path used by the sample:

```bash
npm install @a2ui/react @a2ui/web_core @a2ui/markdown-it react react-dom
```

Use the versioned v0.9 imports because the restaurant sample is built around A2UI v0.9:

```ts
import { A2uiSurface, basicCatalog, MarkdownContext } from "@a2ui/react/v0_9";
import { MessageProcessor, type A2uiClientMessage, type A2uiMessage } from "@a2ui/web_core/v0_9";
import { renderMarkdown } from "@a2ui/markdown-it";
```

## Minimal React wiring

### 1. Create the message processor

`MessageProcessor` is the core state machine. It owns surfaces, components, data binding, and action dispatch.

```tsx
import { useMemo, useRef } from "react";
import { A2uiSurface, basicCatalog, MarkdownContext } from "@a2ui/react/v0_9";
import { MessageProcessor, type A2uiClientMessage } from "@a2ui/web_core/v0_9";
import { renderMarkdown } from "@a2ui/markdown-it";

export function A2uiScreen() {
  const sendRef = useRef<((message: A2uiClientMessage | string) => Promise<void>) | null>(null);

  const processor = useMemo(() => {
    return new MessageProcessor([basicCatalog], (action) => {
      sendRef.current?.({ version: "v0.9", action });
    });
  }, []);

  return (
    <MarkdownContext.Provider value={renderMarkdown}>
      {/* render surfaces here */}
    </MarkdownContext.Provider>
  );
}
```

Why this matters:

- `basicCatalog` must exist on the client if the agent emits the basic A2UI catalog.
- the action callback is the React equivalent of Flutter's `surfaceController.onSubmit.listen(...)`

### 2. Track active surfaces

The React shell sample subscribes to `onSurfaceCreated` and `onSurfaceDeleted`, then renders each surface with `A2uiSurface`.

```tsx
const [surfaces, setSurfaces] = useState(() =>
  Array.from(processor.model.surfacesMap.values()),
);

useEffect(() => {
  const created = processor.onSurfaceCreated((surface) => {
    setSurfaces((prev) => [...prev, surface]);
  });

  const deleted = processor.onSurfaceDeleted((id) => {
    setSurfaces((prev) => prev.filter((surface) => surface.id !== id));
  });

  return () => {
    created.unsubscribe();
    deleted.unsubscribe();
  };
}, [processor]);
```

Render:

```tsx
{surfaces.map((surface) => (
  <A2uiSurface key={surface.id} surface={surface} />
))}
```

### 3. Send text and action messages through one client

The sample uses one `send()` path for both plain user text and structured UI actions.

```ts
async function send(message: A2uiClientMessage | string) {
  const response = await fetch("/a2a", {
    method: "POST",
    body: typeof message === "string" ? message : JSON.stringify(message),
  });

  // parse SSE or JSON, then feed each chunk into:
  // processor.processMessages(chunkMessages)
}
```

This is important because:

- plain text starts the flow
- structured `{ version: "v0.9", action: ... }` messages continue the flow after button clicks and form submissions

## The transport layer

The Flutter sample talks directly to `http://localhost:10002` using an A2A-aware connector.

The React shell does not do that directly from the browser. Instead, it uses a local `/a2a` endpoint in Vite middleware that:

1. accepts browser requests
2. forwards them to the A2A agent
3. adds the A2UI extension header
4. returns SSE chunks or JSON back to the browser

That proxy is a good pattern for us too.

### Why use a proxy

- browsers should not need to know A2A details
- you can add auth, logging, rate limits, and retries
- you can normalize streaming into one frontend contract

### Important A2A detail from the sample

The proxy sets:

```http
X-A2A-Extensions: https://a2ui.org/a2a-extension/a2ui/v0.9
```

That tells the A2A agent that the client wants the A2UI extension activated.

## What the agent must send

For the restaurant flow, the agent sends messages like:

```json
{
  "version": "v0.9",
  "createSurface": {
    "surfaceId": "default",
    "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
  }
}
```

Then:

```json
{
  "version": "v0.9",
  "updateComponents": {
    "surfaceId": "default",
    "components": [
      { "id": "root", "component": "Column", "children": ["title", "list"] }
    ]
  }
}
```

Then:

```json
{
  "version": "v0.9",
  "updateDataModel": {
    "surfaceId": "default",
    "path": "/",
    "value": {
      "title": "Top restaurants",
      "items": []
    }
  }
}
```

The React side does not invent UI. It only processes and renders these messages.

## What the client sends back

When the user clicks `Book Now`, the rendered button action becomes an A2UI client message:

```json
{
  "version": "v0.9",
  "action": {
    "name": "book_restaurant",
    "surfaceId": "default",
    "sourceComponentId": "template-book-button",
    "timestamp": "2026-06-15T12:00:00.000Z",
    "context": {
      "restaurantName": "Han Dynasty",
      "imageUrl": "https://...",
      "address": "90 3rd Ave, New York, NY 10003"
    }
  }
}
```

The sample agent reads that payload and decides whether to return:

- a booking form
- a confirmation surface
- or another updated surface

## React implementation checklist

If we connect A2UI in this project, the practical checklist is:

1. Add `@a2ui/react`, `@a2ui/web_core`, and `@a2ui/markdown-it`.
2. Create a single `MessageProcessor` instance for the page or session.
3. Register the catalog(s) the agent is allowed to target.
4. Build a transport client that accepts both text and `A2uiClientMessage`.
5. Support streaming and call `processor.processMessages(...)` per chunk.
6. Subscribe to created/deleted surfaces and render them with `A2uiSurface`.
7. Route renderer actions back through the same transport client.
8. Clear old surfaces deliberately when starting a new top-level request if that matches the UX you want.

## Common pitfalls from the sample

- Catalog mismatch: the client and agent must agree on `catalogId`.
- Duplicate `createSurface` during streaming: the React sample de-duplicates repeated surface creation events.
- Missing `version: "v0.9"` on client action messages.
- Treating A2UI like arbitrary remote JSX. It is declarative data, not executable UI code.
- Sending browser requests straight to the agent when a small server-side proxy would be safer and easier to control.

## Recommended approach for our React app

For our case, I would use the direct renderer path first:

1. React frontend with `@a2ui/react/v0_9`
2. small server endpoint or proxy at `/a2a`
3. `MessageProcessor([basicCatalog], actionHandler)`
4. one session/controller hook that owns request state, errors, and active surfaces

Use AG-UI and CopilotKit only if we also want their broader agent chat/runtime stack. If the immediate goal is "connect to an A2UI-capable agent and render its protocol messages in React", the restaurant sample shows that the thinner direct integration is enough.

## Starter file layout

```text
src/
  a2ui/
    client.ts          # fetch/SSE transport
    session.ts         # owns MessageProcessor and request lifecycle
    catalogs.ts        # basicCatalog + any custom catalog
  components/
    A2uiShell.tsx      # form, loading, errors, surface list
```

## Bottom line

The clean React translation of the Flutter `restaurant_finder` sample is:

- replace `A2uiAgentConnector` with a browser-safe transport client
- replace `SurfaceController` with `MessageProcessor`
- render each active surface with `A2uiSurface`
- send button/form actions back as A2UI v0.9 client action messages

That is the integration boundary. Once that boundary is in place, the agent can drive multi-step UI flows like restaurant search -> booking form -> confirmation without the frontend hardcoding each screen.
