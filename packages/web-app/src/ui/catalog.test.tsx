import { describe, expect, it } from "bun:test";
import type { Spec } from "@json-render/core";
import { renderToStaticMarkup } from "react-dom/server";

import {
  getActionFeedbackMessage,
  getTextInputAutoComplete,
  JsonRenderPreview,
  uiCatalog,
} from "./catalog.tsx";

describe("preview actions", () => {
  it("registers default demo actions in the catalog", () => {
    expect(uiCatalog.actionNames).toEqual(["demo_action", "submit_demo"]);
  });

  it("provides visible feedback text for registered and unknown actions", () => {
    expect(getActionFeedbackMessage("demo_action")).toBe("Demo action ran.");
    expect(getActionFeedbackMessage("submit_demo")).toBe("Demo submitted.");
    expect(getActionFeedbackMessage("missing_action")).toBe(
      'Action "missing_action" is not wired yet.',
    );
  });
});

describe("TextInput semantics", () => {
  it("selects autocomplete values for password and email fields", () => {
    expect(getTextInputAutoComplete({ label: "Password", name: "password" })).toBeUndefined();
    expect(
      getTextInputAutoComplete({ label: "Password", name: "password", inputType: "password" }),
    ).toBe("current-password");
    expect(
      getTextInputAutoComplete({
        label: "New password",
        name: "newPassword",
        inputType: "password",
      }),
    ).toBe("new-password");
    expect(getTextInputAutoComplete({ label: "Email", name: "email", inputType: "email" })).toBe(
      "email",
    );
  });

  it("renders generated password inputs inside a form with autocomplete", () => {
    const spec: Spec = {
      root: "password",
      elements: {
        password: {
          type: "TextInput",
          props: { label: "Password", name: "password", inputType: "password" },
          children: [],
        },
      },
    };

    const html = renderToStaticMarkup(<JsonRenderPreview loading={false} spec={spec} />);

    expect(html).toContain("<form");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
  });
});
