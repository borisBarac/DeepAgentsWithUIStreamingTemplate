import type { ComponentInstance } from "@deep-agent-template/core/generative-ui";
import type { Spec } from "@json-render/core";

export function componentInstancesToSpec(
  components: readonly ComponentInstance[],
  rootId = components[0]?.id ?? "",
): Spec {
  return {
    root: rootId,
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
