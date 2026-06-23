## Implementation instructions: LangChain Generative UI with `json-render`

Use LangChain’s Generative UI pattern when you want the agent to return a **UI specification** instead of plain text. The frontend renders that spec using a fixed set of developer-approved components. LangChain’s doc describes this as: define a catalog, have the AI generate a JSON UI tree, then render it safely with `json-render`. ([docs.langchain.com][1])

---

# 1. Install required packages

In your frontend app, install the LangChain React package and `json-render` packages.

```bash
npm install @langchain/react @json-render/core @json-render/react zod langchain
```

Use the equivalent package manager command if you are using Bun:

```bash
bun add @langchain/react @json-render/core @json-render/react zod langchain
```

---

# 2. Define the component catalog

Create a catalog that describes which UI components the AI is allowed to use.

The catalog is the guardrail: the agent can only generate components that exist in this catalog, with props matching your schemas. The LangChain docs recommend keeping catalogs focused because smaller catalogs produce better results. ([docs.langchain.com][1])

```ts
// src/generative-ui/catalog.ts
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

export const catalog = defineCatalog(schema, {
  components: {
    Card: {
      description: "A card container with optional title and padding",
      props: z.object({
        title: z.string().optional(),
        padding: z.enum(["sm", "md", "lg"]).optional(),
      }),
    },

    Stack: {
      description:
        "Layout children vertically or horizontally with consistent spacing",
      props: z.object({
        direction: z.enum(["vertical", "horizontal"]).optional(),
        gap: z.enum(["sm", "md", "lg"]).optional(),
      }),
    },

    TextInput: {
      description: "A text input field with optional label and placeholder",
      props: z.object({
        label: z.string().optional(),
        placeholder: z.string().optional(),
        type: z
          .enum(["text", "email", "password", "number", "textarea"])
          .optional(),
      }),
    },

    Button: {
      description: "A clickable button with label and style variants",
      props: z.object({
        label: z.string(),
        variant: z.enum(["primary", "secondary", "ghost", "link"]).optional(),
        fullWidth: z.boolean().optional(),
      }),
    },
  },

  actions: {},
});
```

---

# 3. Build the component registry

Create a registry that maps catalog component names to actual React components.

`defineRegistry` gives type-safe bindings between your catalog props and the rendering implementation. The `Renderer` later uses this registry to render the generated JSON spec. ([docs.langchain.com][1])

```tsx
// src/generative-ui/registry.tsx
import { defineRegistry } from "@json-render/react";
import { catalog } from "./catalog";

export const { registry } = defineRegistry(catalog, {
  components: {
    Card: ({ props, children }) => (
      <div className={`card card-padding-${props.padding ?? "md"}`}>
        {props.title && <h2>{props.title}</h2>}
        {children}
      </div>
    ),

    Stack: ({ props, children }) => (
      <div
        className={[
          "stack",
          `stack-${props.direction ?? "vertical"}`,
          `gap-${props.gap ?? "md"}`,
        ].join(" ")}
      >
        {children}
      </div>
    ),

    TextInput: ({ props }) => (
      <div className="field">
        {props.label && <label>{props.label}</label>}
        {props.type === "textarea" ? (
          <textarea placeholder={props.placeholder} />
        ) : (
          <input
            type={props.type ?? "text"}
            placeholder={props.placeholder}
          />
        )}
      </div>
    ),

    Button: ({ props }) => (
      <button
        className={`button button-${props.variant ?? "primary"}`}
        style={{ width: props.fullWidth ? "100%" : undefined }}
      >
        {props.label}
      </button>
    ),
  },
});
```

---

# 4. Connect the frontend to the LangChain agent

Use `useStream` from `@langchain/react` and point it at your LangGraph/LangChain server.

The docs show `useStream` configured with an `apiUrl` and `assistantId`, then extracting the generated UI spec from the AI message’s first tool call arguments. ([docs.langchain.com][1])

```tsx
// src/generative-ui/GenerativeUI.tsx
import { useStream } from "@langchain/react";
import { AIMessage } from "langchain";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { registry } from "./registry";

export function GenerativeUI() {
  const stream = useStream({
    apiUrl: "http://localhost:2024",
    assistantId: "generative_ui",
  });

  const aiMessage = stream.messages.find(AIMessage.isInstance);
  const rawSpec = aiMessage?.tool_calls?.[0]?.args;

  const spec = normalizeStreamingSpec(rawSpec);

  return (
    <>
      {spec && (
        <JSONUIProvider registry={registry}>
          <Renderer
            spec={spec}
            registry={registry}
            loading={stream.isLoading}
          />
        </JSONUIProvider>
      )}
    </>
  );
}
```

---

# 5. Filter partial streaming output before rendering

During streaming, the generated spec may be incomplete. Some elements may arrive before they have a valid `type` or `props`.

Only render elements that have both a valid `type` and non-null `props`. The docs also recommend passing `loading={true}` while streaming so the renderer skips missing children gracefully. ([docs.langchain.com][1])

```ts
// src/generative-ui/normalizeStreamingSpec.ts
type RawElement = {
  type?: string;
  props?: Record<string, unknown> | null;
  children?: string[];
};

type RawSpec = {
  root?: string;
  elements?: Record<string, RawElement>;
};

export function normalizeStreamingSpec(rawSpec: RawSpec | undefined | null) {
  if (!rawSpec?.root || !rawSpec?.elements) {
    return null;
  }

  const rootEl = rawSpec.elements[rawSpec.root];

  if (!rootEl?.type || rootEl.props == null) {
    return null;
  }

  const safeElements: Record<string, RawElement> = {};

  for (const [key, element] of Object.entries(rawSpec.elements)) {
    if (element?.type && element.props != null) {
      safeElements[key] = {
        ...element,
        children: element.children ?? [],
      };
    }
  }

  return {
    root: rawSpec.root,
    elements: safeElements,
  };
}
```

Then import it:

```tsx
import { normalizeStreamingSpec } from "./normalizeStreamingSpec";
```

---

# 6. Expected UI spec format

Your agent should return a flat JSON spec with:

```ts
{
  root: string;
  elements: Record<
    string,
    {
      type: string;
      props: Record<string, unknown>;
      children: string[];
    }
  >;
}
```

Example:

```json
{
  "root": "login-card",
  "elements": {
    "login-card": {
      "type": "Card",
      "props": { "title": "Login" },
      "children": ["login-stack"]
    },
    "login-stack": {
      "type": "Stack",
      "props": { "direction": "vertical", "gap": "md" },
      "children": ["email-input", "password-input", "submit-btn"]
    },
    "email-input": {
      "type": "TextInput",
      "props": {
        "label": "Email",
        "placeholder": "Enter your email",
        "type": "email"
      },
      "children": []
    },
    "password-input": {
      "type": "TextInput",
      "props": {
        "label": "Password",
        "placeholder": "Enter your password",
        "type": "password"
      },
      "children": []
    },
    "submit-btn": {
      "type": "Button",
      "props": {
        "label": "Sign In",
        "variant": "primary",
        "fullWidth": true
      },
      "children": []
    }
  }
}
```

Each element references children by ID. Leaf elements should use an empty `children` array. ([docs.langchain.com][1])

---

# 7. Backend / agent requirements

Configure your LangChain/LangGraph agent so that it returns the JSON UI spec as structured output or a tool call.

The frontend assumes the generated spec is available here:

```ts
aiMessage?.tool_calls?.[0]?.args
```

Therefore, your backend should expose an assistant named:

```ts
generative_ui
```

or update the frontend to match your actual assistant ID:

```ts
assistantId: "your_assistant_id"
```

The backend output should follow the spec format exactly:

```json
{
  "root": "some-root-id",
  "elements": {
    "some-root-id": {
      "type": "Card",
      "props": {},
      "children": []
    }
  }
}
```

---

# 8. Add minimal CSS

```css
.card {
  border: 1px solid var(--border-color, #ddd);
  border-radius: 12px;
  background: var(--surface-color, #fff);
}

.card-padding-sm {
  padding: 0.75rem;
}

.card-padding-md {
  padding: 1rem;
}

.card-padding-lg {
  padding: 1.5rem;
}

.stack {
  display: flex;
}

.stack-vertical {
  flex-direction: column;
}

.stack-horizontal {
  flex-direction: row;
}

.gap-sm {
  gap: 0.5rem;
}

.gap-md {
  gap: 1rem;
}

.gap-lg {
  gap: 1.5rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.button {
  border: 0;
  border-radius: 8px;
  padding: 0.625rem 1rem;
  cursor: pointer;
}

.button-primary {
  background: var(--primary-color, #111);
  color: white;
}

.button-secondary {
  background: var(--secondary-color, #eee);
  color: #111;
}
```

LangChain recommends using design tokens or CSS variables so generated components adapt cleanly to themes. ([docs.langchain.com][1])

---

# 9. Implementation checklist

Use this as the actual build checklist:

1. Install `@langchain/react`, `@json-render/core`, `@json-render/react`, `zod`, and `langchain`.
2. Create `catalog.ts` with only the components the AI is allowed to use.
3. Give every component a clear description and a strict Zod props schema.
4. Create `registry.tsx` mapping each catalog component to a React implementation.
5. Create `normalizeStreamingSpec.ts` to filter partial streamed elements.
6. Create `GenerativeUI.tsx` using `useStream`.
7. Set the correct `apiUrl`.
8. Set the correct `assistantId`.
9. Extract the generated spec from `aiMessage.tool_calls[0].args`.
10. Wrap the renderer in `JSONUIProvider`.
11. Render with `Renderer`.
12. Pass `loading={stream.isLoading}`.
13. Make the backend agent return a flat spec with `root` and `elements`.
14. Test with a simple prompt like: “Create a login form.”
15. Expand the catalog only after the basic flow works.

---

# 10. Important constraints

Do not let the model generate arbitrary React, HTML, or JavaScript. It should only generate JSON specs using your approved catalog.

Do not render incomplete streamed elements. Validate that each element has both `type` and `props`.

Do not create a huge component catalog at first. Start with layout, text, form, card, and button components, then grow from there.

Do not render `Renderer` outside `JSONUIProvider`; the docs state that the provider is required for json-render’s internal context, including state, visibility, validation, and actions. ([docs.langchain.com][1])

[1]: https://docs.langchain.com/oss/python/langchain/frontend/generative-ui "Generative UI - Docs by LangChain"
