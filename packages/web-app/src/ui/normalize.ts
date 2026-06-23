import type { Spec, UIElement } from "@json-render/core";

import { type ComponentTypeName, componentPropsSchemas, componentTypes } from "./schema.ts";

const knownComponentTypes = new Set<string>(componentTypes);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeElement(value: unknown): UIElement | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = value.type;
  if (typeof type !== "string" || !knownComponentTypes.has(type)) {
    return null;
  }

  if (!isRecord(value.props)) {
    return null;
  }

  const children = value.children;
  if (!Array.isArray(children) || children.some((child) => typeof child !== "string")) {
    return null;
  }

  const parsedProps = componentPropsSchemas[type as ComponentTypeName].safeParse(value.props);
  if (!parsedProps.success) {
    return null;
  }

  return {
    type,
    props: parsedProps.data,
    children,
    ...(value.visible !== undefined ? { visible: value.visible as UIElement["visible"] } : {}),
  };
}

export function normalizeStreamingSpec(value: unknown): Spec | null {
  if (!isRecord(value) || typeof value.root !== "string" || !isRecord(value.elements)) {
    return null;
  }

  if (!(value.root in value.elements)) {
    return null;
  }

  const elements: Spec["elements"] = {};

  for (const [key, elementValue] of Object.entries(value.elements)) {
    const element = normalizeElement(elementValue);
    if (!element) {
      return null;
    }
    elements[key] = element;
  }

  for (const [key, element] of Object.entries(elements)) {
    for (const child of element.children ?? []) {
      if (!(child in elements)) {
        return null;
      }
      if (child === key) {
        return null;
      }
    }
  }

  return {
    root: value.root,
    elements,
  };
}
