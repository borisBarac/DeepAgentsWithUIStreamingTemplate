import { describe, expect, it } from "bun:test";

import {
  createChatModel,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_MODEL_ID,
  resolveModelIdentifier,
} from "./models";

describe("resolveModelIdentifier", () => {
  it("uses OpenRouter DeepSeek V4 by default", () => {
    expect(resolveModelIdentifier()).toEqual({
      provider: "openrouter",
      model: DEFAULT_DEEPSEEK_MODEL,
    });
  });

  it("parses provider-prefixed model identifiers", () => {
    expect(resolveModelIdentifier(DEFAULT_MODEL_ID)).toEqual({
      provider: "openrouter",
      model: DEFAULT_DEEPSEEK_MODEL,
    });
  });

  it("rejects unsupported providers", () => {
    expect(() => resolveModelIdentifier("openai:gpt-4o-mini")).toThrow(
      "Unsupported model identifier",
    );
  });
});

describe("createChatModel", () => {
  it("creates an OpenRouter chat model", () => {
    const model = createChatModel({
      openRouter: {
        apiKey: "test-key",
      },
    });

    expect(model.model).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(model._llmType()).toBe("openrouter");
  });
});
