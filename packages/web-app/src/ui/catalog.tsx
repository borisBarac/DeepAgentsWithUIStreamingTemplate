"use client";

import type { Spec, UIElement } from "@json-render/core";
import { defineCatalog } from "@json-render/core";
import type { ComponentRegistry } from "@json-render/react";
import { JSONUIProvider, Renderer, schema, useDataBinding } from "@json-render/react";
import type { z } from "zod";

import {
  buttonPropsSchema,
  cardPropsSchema,
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
  actions: {},
});

function getProps<P>(element: UIElement<string, P>): P {
  return element.props;
}

export const registry: ComponentRegistry = {
  Button: ({ element, onAction }) => {
    const props = getProps(element) as z.infer<typeof buttonPropsSchema>;
    return (
      <button
        className="jr-button"
        type="button"
        onClick={() => props.action && onAction?.({ name: props.action })}
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
  return (
    <JSONUIProvider initialData={INITIAL_DATA} registry={registry}>
      <Renderer loading={loading} registry={registry} spec={spec} />
    </JSONUIProvider>
  );
}
