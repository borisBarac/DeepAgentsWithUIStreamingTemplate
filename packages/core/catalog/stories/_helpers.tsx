import type { ComponentInstance, UiSpecUpdate } from "@deep-agent-template/core/generative-ui";
import type { Spec } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { Fragment, type ReactNode, useState } from "react";
import {
  getActionFeedbackMessage,
  PreviewActionContext,
  registry,
} from "../../../web-app/src/ui/catalog.tsx";

/**
 * The catalog's authoritative source. Stories import this to keep
 * documentation aligned with the JSON Schemas the agent and validator use.
 */
export {
  catalog,
  catalogComponentNames,
  catalogLimits,
  catalogVersion,
} from "@deep-agent-template/core/generative-ui";
export { getActionFeedbackMessage, registry };

/**
 * Wrap any ReactNode in the same JSON-UI providers the production preview
 * uses, so a bare catalog component renders exactly as it would inside
 * `JsonRenderPreview`.
 *
 * Mirrors `JsonRenderPreview` in `packages/web-app/src/ui/catalog.tsx`:
 * - `PreviewActionContext.Provider` wires the `demo_action` / `submit_demo`
 *   feedback messages and renders the live region below the spec.
 * - `JSONUIProvider` carries the registry + form data context.
 */
export function PreviewSurface({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <PreviewActionContext.Provider
      value={{
        message,
        runAction: (actionName) => setMessage(getActionFeedbackMessage(actionName)),
      }}
    >
      <JSONUIProvider initialData={{}} registry={registry}>
        {children}
        {message ? (
          <p aria-live="polite" className="jr-action-feedback">
            {message}
          </p>
        ) : null}
      </JSONUIProvider>
    </PreviewActionContext.Provider>
  );
}

/**
 * Render one or more catalog {@link Spec} objects using the real production
 * `<Renderer>` from the web-app. Use this when a story needs to exercise the
 * component in its native spec shape (which is what the agent emits).
 */
export function CatalogSpecPreview({ spec, loading = false }: { spec: Spec; loading?: boolean }) {
  return (
    <PreviewSurface>
      <Renderer loading={loading} registry={registry} spec={spec} />
    </PreviewSurface>
  );
}

/**
 * Build a minimal {@link Spec} from one or more {@link ComponentInstance}s.
 * Mirrors the same component-instance → spec adapter the chat stream uses on
 * the client (`spec-adapter.ts`), so stories always stay compatible with
 * production payloads.
 */
export function specFromInstances(
  components: Array<ComponentInstance & { children?: string[] }>,
  rootId?: string,
): Spec {
  const root = rootId ?? components[0]?.id ?? "";
  return {
    root,
    elements: Object.fromEntries(
      components.map(({ id, component, children, ...props }) => [
        id,
        {
          type: component,
          props,
          ...(children === undefined ? {} : { children }),
        },
      ]),
    ),
  };
}

/**
 * Build a {@link Spec} from a single root component. Convenience wrapper for
 * the most common story shape — one component, no children.
 */
export function singleSpec<C extends string>(
  component: C,
  props: Record<string, unknown> = {},
  id = "root",
): Spec {
  return specFromInstances([{ id, component, ...props }]);
}

/**
 * Build a {@link UiSpecUpdate} payload exactly the way the agent emits it.
 * Useful for documentation that shows the on-the-wire shape.
 */
export function uiSpecUpdate(
  components: Array<ComponentInstance & { children?: string[] }>,
  rootId?: string,
): UiSpecUpdate {
  return { type: "ui", components, rootId };
}

/**
 * Wrap a node in a fragment with no provider — useful for stories that show
 * a component in isolation when no form / data context is required.
 */
export function Bare({ children }: { children: ReactNode }) {
  return <Fragment>{children}</Fragment>;
}
