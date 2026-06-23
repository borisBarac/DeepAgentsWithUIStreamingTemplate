import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  createImageGenerationServiceFromEnv,
  DEFAULT_FIXED_IMAGE_URL,
  REPLICATE_API_TOKEN_ENV,
  type ReplicateCompatibleClient,
  USE_FAKE_IMAGE_PROVIDER_ENV,
} from "./index.ts";

describe("createImageGenerationServiceFromEnv", () => {
  const originalFake = process.env[USE_FAKE_IMAGE_PROVIDER_ENV];
  const originalToken = process.env[REPLICATE_API_TOKEN_ENV];

  beforeEach(() => {
    delete process.env[USE_FAKE_IMAGE_PROVIDER_ENV];
    delete process.env[REPLICATE_API_TOKEN_ENV];
  });

  afterEach(() => {
    setEnv(USE_FAKE_IMAGE_PROVIDER_ENV, originalFake);
    setEnv(REPLICATE_API_TOKEN_ENV, originalToken);
  });

  it("defaults to the fake provider when the flag is unset", async () => {
    const service = createImageGenerationServiceFromEnv();
    const result = await service.generate({ prompt: "A red panda" });

    expect(result).toEqual({ success: true, url: DEFAULT_FIXED_IMAGE_URL });
  });

  it("uses the fake provider when USE_FAKE_IMAGE_PROVIDER is 'true'", async () => {
    process.env[USE_FAKE_IMAGE_PROVIDER_ENV] = "true";
    const service = createImageGenerationServiceFromEnv();
    const result = await service.generate({ prompt: "A red panda" });

    expect(result).toEqual({ success: true, url: DEFAULT_FIXED_IMAGE_URL });
  });

  it("honors a custom fixedImageUrl override on the fake provider", async () => {
    const service = createImageGenerationServiceFromEnv({
      fixedImageUrl: "https://example.com/custom.jpg",
    });
    const result = await service.generate({ prompt: "A red panda" });

    expect(result).toEqual({ success: true, url: "https://example.com/custom.jpg" });
  });

  it("uses the real provider when USE_FAKE_IMAGE_PROVIDER is 'false' and a client is injected", async () => {
    process.env[USE_FAKE_IMAGE_PROVIDER_ENV] = "false";
    const calls: Array<{ model: string; input: object }> = [];
    const client: ReplicateCompatibleClient = {
      async run(model, options) {
        calls.push({ model, input: options.input });
        return ["https://example.com/replicate.png"];
      },
    };

    const service = createImageGenerationServiceFromEnv({ replicateClient: client });
    const result = await service.generate({ prompt: "A red panda" });

    expect(result).toEqual({ success: true, url: "https://example.com/replicate.png" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toEqual({ prompt: "A red panda" });
  });

  it("builds the real provider from REPLICATE_API_TOKEN when no client is injected", async () => {
    process.env[USE_FAKE_IMAGE_PROVIDER_ENV] = "false";
    process.env[REPLICATE_API_TOKEN_ENV] = "r8_test_token";

    expect(() => createImageGenerationServiceFromEnv()).not.toThrow();
  });

  it("throws when real mode is requested without a token or client", () => {
    process.env[USE_FAKE_IMAGE_PROVIDER_ENV] = "false";

    expect(() => createImageGenerationServiceFromEnv()).toThrow(
      'USE_FAKE_IMAGE_PROVIDER="false" requires REPLICATE_API_TOKEN to be set.',
    );
  });

  it("throws on an invalid USE_FAKE_IMAGE_PROVIDER value", () => {
    process.env[USE_FAKE_IMAGE_PROVIDER_ENV] = "yes";

    expect(() => createImageGenerationServiceFromEnv()).toThrow(
      'USE_FAKE_IMAGE_PROVIDER must be "true" or "false"',
    );
  });

  it("lets the useFake override take precedence over the env value", async () => {
    process.env[USE_FAKE_IMAGE_PROVIDER_ENV] = "false";
    const service = createImageGenerationServiceFromEnv({ useFake: true });
    const result = await service.generate({ prompt: "A red panda" });

    expect(result).toEqual({ success: true, url: DEFAULT_FIXED_IMAGE_URL });
  });

  it("parses the flag case-insensitively", async () => {
    process.env[USE_FAKE_IMAGE_PROVIDER_ENV] = "FALSE";
    const client: ReplicateCompatibleClient = {
      run: async () => ["https://example.com/upper.png"],
    };

    const service = createImageGenerationServiceFromEnv({ replicateClient: client });
    const result = await service.generate({ prompt: "A red panda" });

    expect(result).toEqual({ success: true, url: "https://example.com/upper.png" });
  });
});

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
