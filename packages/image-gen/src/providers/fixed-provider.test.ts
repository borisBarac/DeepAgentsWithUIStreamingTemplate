import { describe, expect, it } from "bun:test";
import {
  createFixedImageGenerationProvider,
  DEFAULT_FIXED_IMAGE_URL,
  FixedImageGenerationProvider,
} from "./fixed-provider.ts";

describe("FixedImageGenerationProvider", () => {
  it("returns the default image URL for generation and editing", async () => {
    const provider = createFixedImageGenerationProvider();

    expect(await provider.generate({ prompt: "Generate an image" })).toBe(DEFAULT_FIXED_IMAGE_URL);
    expect(
      await provider.edit({
        prompt: "Edit an image",
        imageUrl: "https://example.com/source.png",
      }),
    ).toBe(DEFAULT_FIXED_IMAGE_URL);
  });

  it("returns a configured image URL", async () => {
    const imageUrl = "https://example.com/fixed.png";
    const provider = new FixedImageGenerationProvider({ imageUrl });

    expect(await provider.generate({ prompt: "Ignored by the fixed provider" })).toBe(imageUrl);
  });
});
