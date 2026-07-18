import { describe, expect, it } from "bun:test";
import { component, message as messageUpdate, modelOutput, uiSpec } from "./builder.ts";
import { safeEmit, safeEmitModelOutput } from "./emit.ts";
import { toErrorEnvelope } from "./errors.ts";
import { validateUpdate } from "./validator.ts";

describe("safeEmit — strict mode", () => {
  it("returns the update when valid", () => {
    const result = safeEmit(messageUpdate("hi"), { strict: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.update.type).toBe("message");
  });

  it("throws on an invalid update", () => {
    let thrown: unknown = null;
    try {
      safeEmit({ type: "ui", components: [] }, { strict: true });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("A2UI validation failed");
    expect((thrown as Error & { issues: unknown[] }).issues).toBeDefined();
  });

  it("includes the first issue's path and code in the thrown message", () => {
    let thrown: Error | null = null;
    try {
      safeEmit(
        {
          type: "ui",
          components: [{ id: "x", component: "Mystery" }],
        },
        { strict: true },
      );
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.message).toContain("code=unknown_component");
    expect(thrown?.message).toContain("path=components[0].component");
  });
});

describe("safeEmit — lenient mode", () => {
  it("returns the update when valid", () => {
    const result = safeEmit(messageUpdate("hi"));
    expect(result.ok).toBe(true);
  });

  it("substitutes an error envelope when the update is invalid", () => {
    const result = safeEmit({ type: "ui", components: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.envelope.type).toBe("error");
      expect(result.envelope.message.length).toBeGreaterThan(0);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(validateUpdate(result.envelope).ok).toBe(true);
    }
  });

  it("handles a ui update with an unknown component gracefully", () => {
    const result = safeEmit({
      type: "ui",
      components: [{ id: "x", component: "Mystery" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe("unknown_component");
    }
  });
});

describe("safeEmitModelOutput", () => {
  it("returns the output when valid (strict)", () => {
    const result = safeEmitModelOutput(
      modelOutput([messageUpdate("hi"), uiSpec([component("t", "Text", { text: "body" })])]),
      { strict: true },
    );
    expect(result.ok).toBe(true);
  });

  it("throws when an embedded ui update fails (strict)", () => {
    expect(() =>
      safeEmitModelOutput(
        {
          version: 1,
          updates: [
            {
              type: "ui",
              components: [{ id: "x", component: "Stack", children: ["ghost"] }],
            },
          ],
        },
        { strict: true },
      ),
    ).toThrow();
  });

  it("returns a canonical error envelope in lenient mode", () => {
    const result = safeEmitModelOutput({
      version: 1,
      updates: [
        {
          type: "ui",
          components: [{ id: "x", component: "Stack", children: ["ghost"] }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.envelope.type).toBe("error");
      expect(validateUpdate(result.envelope).ok).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("toErrorEnvelope", () => {
  it("uses the first issue's diagnostics", () => {
    const envelope = toErrorEnvelope([
      {
        path: "components[0].label",
        code: "invalid_envelope",
        message: "must have string label",
      },
      {
        path: "components[1].text",
        code: "invalid_envelope",
        message: "must have string text",
      },
    ]);
    expect(envelope.message).toBe("must have string label");
    expect(envelope.type).toBe("error");
  });

  it("synthesizes a generic envelope when issues list is empty", () => {
    const envelope = toErrorEnvelope([]);
    expect(envelope.message).toContain("rejected");
  });
});
