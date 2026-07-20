"use client";

import type { Spec, UIElement } from "@json-render/core";
import { defineCatalog } from "@json-render/core";
import type { ComponentRegistry } from "@json-render/react";
import { JSONUIProvider, Renderer, schema, useDataBinding } from "@json-render/react";
import { createContext, useContext, useState } from "react";
import { z } from "zod";

// Permissive Zod for every component's props. The authoritative validator is
// the catalog.json-backed A2UI validator (server + client mini-validator in
// Phase D). The Zod type only serves to satisfy defineCatalog's API; it does
// not enforce prop shape. This removes the dual-definition hazard where the
// Zod schemas and the catalog could drift.
const permissiveProps = z.record(z.string(), z.unknown());

export const uiCatalog = defineCatalog(schema, {
  components: {
    Button: {
      props: permissiveProps,
      description: "A button for local UI actions. Use a concise label.",
    },
    Card: {
      props: permissiveProps,
      description: "A bordered content container. Optional title appears above children.",
    },
    ImagePlaceholder: {
      props: permissiveProps,
      description: "A visual placeholder for a product image that can later be rendered.",
    },
    ProductCard: {
      props: permissiveProps,
      description: "A product concept card with title, description, and image prompt.",
    },
    ProductGrid: {
      props: permissiveProps,
      description: "A responsive container for one or more product concept cards.",
    },
    Stack: {
      props: permissiveProps,
      description: "A layout container. Use column for forms and row for compact action groups.",
    },
    Text: {
      props: permissiveProps,
      description: "Text content. Use title for headings, muted for secondary text.",
    },
    TextInput: {
      props: permissiveProps,
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

// Locally-typed prop shapes for the renderers. These match catalog.json but
// live here so the React components stay statically typed. The authoritative
// runtime check is the A2UI validator (server + client mini-validator in
// Phase D); these TS types are zero-cost at runtime.
type ButtonProps = { label: string; action?: string };
type CardProps = { title?: string };
type ImagePlaceholderProps = { alt?: string; prompt?: string };
type ProductCardProps = {
  title: string;
  description: string;
  imageAlt?: string;
  imagePrompt?: string;
};
type ProductGridProps = { heading?: string };
type StackProps = { direction?: "row" | "column"; gap?: "xs" | "sm" | "md" | "lg" };
type TextProps = { text: string; variant?: "title" | "body" | "muted" | "caption" };
type TextInputProps = {
  label: string;
  name: string;
  placeholder?: string;
  inputType?: "text" | "email" | "password";
};

const DEFAULT_ACTION_LABELS: Record<string, string> = {
  demo_action: "Demo action ran.",
  submit_demo: "Demo submitted.",
};

export function getActionFeedbackMessage(actionName: string): string {
  return DEFAULT_ACTION_LABELS[actionName] ?? `Action "${actionName}" is not wired yet.`;
}

export function getTextInputAutoComplete(props: TextInputProps): string | undefined {
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
    const props = getProps(element) as ButtonProps;
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
    const props = getProps(element) as CardProps;
    return (
      <section className="jr-card">
        {props.title ? <h3>{props.title}</h3> : null}
        {children}
      </section>
    );
  },
  ImagePlaceholder: ({ element }) => {
    const props = getProps(element) as ImagePlaceholderProps;
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
    const props = getProps(element) as ProductCardProps;
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
  ProductGrid: ({ element, children }) => {
    const props = getProps(element) as ProductGridProps;
    return (
      <section className="product-grid-shell">
        {props.heading ? <h2>{props.heading}</h2> : null}
        <div className="product-grid">{children}</div>
      </section>
    );
  },
  Stack: ({ element, children }) => {
    const props = getProps(element) as StackProps;
    const className = [
      "jr-stack",
      props.direction === "row" ? "jr-stack-row" : "jr-stack-column",
      `jr-gap-${props.gap ?? "md"}`,
    ].join(" ");
    return <div className={className}>{children}</div>;
  },
  Text: ({ element }) => {
    const props = getProps(element) as TextProps;
    const variant = props.variant ?? "body";
    if (variant === "title") {
      return <h2 className="jr-text jr-text-title">{props.text}</h2>;
    }
    return <p className={`jr-text jr-text-${variant}`}>{props.text}</p>;
  },
  TextInput: ({ element }) => {
    const props = getProps(element) as TextInputProps;
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
