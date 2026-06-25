import { afterAll, describe, expect, it } from "bun:test";
import type { ImageGenerationResult } from "../src/index.ts";
import { assertLiveImageUrl, createLiveService, hasLiveImageCredentials } from "./helpers.ts";

const REMOTE_EDIT_IMAGE_URL =
  "https://replicate.delivery/xezq/83OKs6yfdoT5YCpfREnrFFbqLbfWbus8Q0e06fQ0BAMDRKamC/tmpu3nqollf.jpg";

const LIVE_TEST_TIMEOUT = 120_000;

const generatedUrls: Array<{ label: string; url: string }> = [];

describe.skipIf(!hasLiveImageCredentials)("image generation live e2e", () => {
  it(
    "generates an image from a text prompt",
    async () => {
      const service = createLiveService();
      const result: ImageGenerationResult = await service.generate({
        prompt: "A serene mountain lake at sunrise, photorealistic, wide angle",
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      await assertLiveImageUrl(result.url);
      generatedUrls.push({ label: "text-to-image", url: result.url });
    },
    LIVE_TEST_TIMEOUT,
  );

  it(
    "edits a previously generated image",
    async () => {
      const service = createLiveService();

      const generated: ImageGenerationResult = await service.generate({
        prompt: "A plain ceramic mug on a wooden table, studio lighting",
      });
      expect(generated.success).toBe(true);
      if (!generated.success) return;

      const result: ImageGenerationResult = await service.edit({
        prompt: "Fill the mug with steaming coffee and add soft morning light",
        imageUrl: generated.url,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      await assertLiveImageUrl(result.url);
      generatedUrls.push({ label: "edit-of-generated", url: result.url });
    },
    LIVE_TEST_TIMEOUT,
  );

  it(
    "edits a remote image URL",
    async () => {
      const service = createLiveService();
      const result: ImageGenerationResult = await service.edit({
        prompt: "Turn this into a vibrant watercolor painting",
        imageUrl: REMOTE_EDIT_IMAGE_URL,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      await assertLiveImageUrl(result.url);
      generatedUrls.push({ label: "edit-remote-url", url: result.url });
    },
    LIVE_TEST_TIMEOUT,
  );

  afterAll(() => {
    if (generatedUrls.length === 0) {
      console.log("\nNo image URLs were generated.\n");
      return;
    }
    console.log("\n=== Generated image URLs ===");
    for (const entry of generatedUrls) {
      console.log(`  [${entry.label}] ${entry.url}`);
    }
    console.log("===========================\n");
  });
});
