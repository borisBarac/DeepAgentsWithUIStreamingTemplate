import { describe, expect, it } from "bun:test";
import { createImageGenerationProvider } from "./factory.ts";
import { DEFAULT_FIXED_IMAGE_URL } from "./fixed-provider.ts";
import type { ReplicateCompatibleClient } from "./replicate-provider.ts";

describe("createImageGenerationProvider", () => {
  it("defaults to the fixed provider", async () => {
    const provider = createImageGenerationProvider();

    expect(await provider.generate({ prompt: "Generate" })).toBe(DEFAULT_FIXED_IMAGE_URL);
  });

  it("switches to the replicate provider when useFake is false", async () => {
    const calls: Array<{ model: string; input: object }> = [];
    const client: ReplicateCompatibleClient = {
      async run(model, options) {
        calls.push({ model, input: options.input });
        return ["https://example.com/replicate.png"];
      },
    };

    const provider = createImageGenerationProvider({ useFake: false, replicateClient: client });
    const result = await provider.generate({ prompt: "Generate" });

    expect(result).toBe("https://example.com/replicate.png");
    expect(calls).toHaveLength(1);
  });

  it("throws when real mode is requested without a client", () => {
    expect(() => createImageGenerationProvider({ useFake: false })).toThrow(
      "A Replicate-compatible client is required when useFake is false.",
    );
  });
});
