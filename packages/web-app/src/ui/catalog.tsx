"use client";

import type { Spec, UIElement } from "@json-render/core";
import { defineCatalog } from "@json-render/core";
import type { ComponentRegistry } from "@json-render/react";
import { JSONUIProvider, Renderer, schema, useDataBinding } from "@json-render/react";
import { createContext, useContext, useState } from "react";
import { z } from "zod";

import {
  buttonPropsSchema,
  cardPropsSchema,
  imagePlaceholderPropsSchema,
  productCardPropsSchema,
  productCardSchema,
  productGridPropsSchema,
  stackPropsSchema,
  textInputPropsSchema,
  textPropsSchema,
} from "./schema.ts";

export const uiCatalog = defineCatalog(schema, {
  components: {
    Button: {
      props: buttonPropsSchema,
      description: "A button for local UI actions. Use a concise label.",
    },
    Card: {
      props: cardPropsSchema,
      description: "A bordered content container. Optional title appears above children.",
    },
    ImagePlaceholder: {
      props: imagePlaceholderPropsSchema,
      description: "A visual placeholder for a product image that can later be rendered.",
    },
    ProductCard: {
      props: productCardPropsSchema,
      description: "A product concept card with title, description, and image prompt.",
    },
    "product-card": {
      props: productCardSchema,
      description: "A scaffold-generated product card with optional generated image URL.",
    },
    ProductGrid: {
      props: productGridPropsSchema,
      description: "A responsive container for one or more product concept cards.",
    },
    Stack: {
      props: stackPropsSchema,
      description: "A layout container. Use column for forms and row for compact action groups.",
    },
    Text: {
      props: textPropsSchema,
      description: "Text content. Use title for headings, muted for secondary text.",
    },
    TextInput: {
      props: textInputPropsSchema,
      description: "A controlled text field. Use name as a stable form field identifier.",
    },
  },
  actions: {
    demo_action: {
      params: z.object({}),
      description: "Shows local preview feedback for a generated demo action.",
    },
    submit_demo: {
      params: z.object({}),
      description: "Shows local preview feedback for a generated submit action.",
    },
  },
});

function getProps<P>(element: UIElement<string, P>): P {
  return element.props;
}

const DEFAULT_ACTION_LABELS: Record<string, string> = {
  demo_action: "Demo action ran.",
  submit_demo: "Demo submitted.",
};

export function getActionFeedbackMessage(actionName: string): string {
  return DEFAULT_ACTION_LABELS[actionName] ?? `Action "${actionName}" is not wired yet.`;
}

export function getTextInputAutoComplete(
  props: z.infer<typeof textInputPropsSchema>,
): string | undefined {
  if (props.inputType === "password") {
    return props.name.toLowerCase().includes("new") ? "new-password" : "current-password";
  }
  if (props.inputType === "email" || props.name.toLowerCase().includes("email")) {
    return "email";
  }
  return undefined;
}

type PreviewActionFeedback = {
  message: string | null;
  runAction: (actionName: string) => void;
};

const PreviewActionContext = createContext<PreviewActionFeedback>({
  message: null,
  runAction: () => undefined,
});

export const registry: ComponentRegistry = {
  Button: ({ element }) => {
    const props = getProps(element) as z.infer<typeof buttonPropsSchema>;
    const { runAction } = useContext(PreviewActionContext);
    return (
      <button
        className="jr-button"
        type="button"
        onClick={() => props.action && runAction(props.action)}
      >
        {props.label}
      </button>
    );
  },
  Card: ({ element, children }) => {
    const props = getProps(element) as z.infer<typeof cardPropsSchema>;
    return (
      <section className="jr-card">
        {props.title ? <h3>{props.title}</h3> : null}
        {children}
      </section>
    );
  },
  ImagePlaceholder: ({ element }) => {
    const props = getProps(element) as z.infer<typeof imagePlaceholderPropsSchema>;
    return (
      <div
        aria-label={props.alt ?? "Product image placeholder"}
        className="product-image"
        role="img"
      >
        <span>{props.prompt ?? props.alt ?? "Image concept"}</span>
      </div>
    );
  },
  ProductCard: ({ element, children }) => {
    const props = getProps(element) as z.infer<typeof productCardPropsSchema>;
    return (
      <article className="product-card">
        <div aria-label={props.imageAlt ?? props.title} className="product-image" role="img">
          <span>{props.imagePrompt ?? props.imageAlt ?? "Image concept"}</span>
        </div>
        <div className="product-card-body">
          <h3>{props.title}</h3>
          <p>{props.description}</p>
          {children}
        </div>
      </article>
    );
  },
  "product-card": ({ element }) => {
    const props = getProps(element) as z.infer<typeof productCardSchema>;
    return (
      <article className="product-card">
        {props.imageUrl ? (
          <div
            aria-label={props.title}
            className="product-image product-image-real"
            role="img"
            style={{ backgroundImage: `url("${props.imageUrl}")` }}
          />
        ) : (
          <div aria-label={props.title} className="product-image" role="img">
            <span>{props.status === "streaming" ? "Image pending" : "Product concept"}</span>
          </div>
        )}
        <div className="product-card-body">
          <h3>{props.title}</h3>
          <p>{props.description}</p>
          {props.status ? <small>{props.status}</small> : null}
        </div>
      </article>
    );
  },
  ProductGrid: ({ element, children }) => {
    const props = getProps(element) as z.infer<typeof productGridPropsSchema>;
    return (
      <section className="product-grid-shell">
        {props.heading ? <h2>{props.heading}</h2> : null}
        <div className="product-grid">{children}</div>
      </section>
    );
  },
  Stack: ({ element, children }) => {
    const props = getProps(element) as z.infer<typeof stackPropsSchema>;
    const className = [
      "jr-stack",
      props.direction === "row" ? "jr-stack-row" : "jr-stack-column",
      `jr-gap-${props.gap ?? "md"}`,
    ].join(" ");
    return <div className={className}>{children}</div>;
  },
  Text: ({ element }) => {
    const props = getProps(element) as z.infer<typeof textPropsSchema>;
    const variant = props.variant ?? "body";
    if (variant === "title") {
      return <h2 className="jr-text jr-text-title">{props.text}</h2>;
    }
    return <p className={`jr-text jr-text-${variant}`}>{props.text}</p>;
  },
  TextInput: ({ element }) => {
    const props = getProps(element) as z.infer<typeof textInputPropsSchema>;
    const [value, setValue] = useDataBinding<string>(`/form/${props.name}`);
    return (
      <label className="jr-field">
        <span>{props.label}</span>
        <input
          autoComplete={getTextInputAutoComplete(props)}
          name={props.name}
          onChange={(event) => setValue(event.target.value)}
          placeholder={props.placeholder ?? ""}
          type={props.inputType ?? "text"}
          value={value ?? ""}
        />
      </label>
    );
  },
};

const INITIAL_DATA: Record<string, unknown> = {};

export function JsonRenderPreview({ loading, spec }: { loading: boolean; spec: Spec | null }) {
  const [message, setMessage] = useState<string | null>(null);

  return (
    <PreviewActionContext.Provider
      value={{
        message,
        runAction: (actionName) => setMessage(getActionFeedbackMessage(actionName)),
      }}
    >
      <JSONUIProvider initialData={INITIAL_DATA} registry={registry}>
        <form
          className="jr-preview-form"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(getActionFeedbackMessage("submit_demo"));
          }}
        >
          <Renderer loading={loading} registry={registry} spec={spec} />
        </form>
        {message ? (
          <p aria-live="polite" className="jr-action-feedback">
            {message}
          </p>
        ) : null}
      </JSONUIProvider>
    </PreviewActionContext.Provider>
  );
}
