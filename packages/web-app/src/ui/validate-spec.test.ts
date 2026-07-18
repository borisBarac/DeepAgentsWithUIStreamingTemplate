import { describe, expect, it } from "bun:test";
import {
  acceptedUiUpdateFixtures,
  rejectedUiUpdateFixtures,
} from "@deep-agent-template/core/generative-ui";

import { parseClientUpdateLine, validateClientUpdate } from "./validate-spec.ts";

describe("browser-safe UI update validation", () => {
  for (const fixture of acceptedUiUpdateFixtures) {
    it(`accepts ${fixture.name}`, () => {
      expect(validateClientUpdate(fixture.value).ok).toBe(true);
    });
  }

  for (const fixture of rejectedUiUpdateFixtures) {
    it(`rejects ${fixture.name} with ${fixture.errorCode}`, () => {
      const result = validateClientUpdate(fixture.value);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((issue) => issue.code === fixture.errorCode)).toBe(true);
      }
    });
  }

  it("reports invalid JSON without throwing", () => {
    expect(parseClientUpdateLine('{"type":')).toEqual({
      ok: false,
      issues: [{ code: "invalid_json", path: "$", message: "This line is not valid JSON." }],
    });
  });
});
