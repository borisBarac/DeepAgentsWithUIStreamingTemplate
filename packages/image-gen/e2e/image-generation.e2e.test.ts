import { afterAll, describe, expect, it } from "bun:test";
import type { ImageGenerationResult } from "../src/index.ts";
import {
  assertLiveImageUrl,
  createLiveService,
  isExpensiveLiveImageE2EEnabled,
  LIVE_IMAGE_HEIGHT,
  LIVE_IMAGE_WIDTH,
} from "./helpers.ts";

const REMOTE_EDIT_IMAGE_URL =
  "https://replicate.delivery/xezq/83OKs6yfdoT5YCpfREnrFFbqLbfWbus8Q0e06fQ0BAMDRKamC/tmpu3nqollf.jpg";

const LIVE_TEST_TIMEOUT = 120_000;
const LIVE_REQUEST_SPACING_MS = 11_000;

const generatedUrls: Array<{ label: string; url: string }> = [];
let liveModelCallCount = 0;
let liveRequestQueue: Promise<void> = Promise.resolve();
let lastLiveRequestFinishedAt = 0;

async function runPacedLiveRequest<T>(request: () => Promise<T>): Promise<T> {
  let releaseQueue: (() => void) | undefined;
  const previousRequest = liveRequestQueue;
  liveRequestQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previousRequest;

  const elapsedSinceLastFinish = Date.now() - lastLiveRequestFinishedAt;
  if (lastLiveRequestFinishedAt > 0 && elapsedSinceLastFinish < LIVE_REQUEST_SPACING_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, LIVE_REQUEST_SPACING_MS - elapsedSinceLastFinish),
    );
  }

  try {
    return await request();
  } finally {
    lastLiveRequestFinishedAt = Date.now();
    releaseQueue?.();
  }
}

describe.skipIf(!isExpensiveLiveImageE2EEnabled)("image generation live e2e", () => {
  it(
    "generates an image from a text prompt",
    async () => {
      const service = createLiveService();
      liveModelCallCount += 1;
      const result: ImageGenerationResult = await runPacedLiveRequest(() =>
        service.generate({
          prompt: "A serene mountain lake at sunrise, photorealistic, wide angle",
          width: LIVE_IMAGE_WIDTH,
          height: LIVE_IMAGE_HEIGHT,
        }),
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      await assertLiveImageUrl(result.url);
      generatedUrls.push({ label: "text-to-image", url: result.url });
      console.info(`[image-gen live e2e] text-to-image: ${result.url}`);
    },
    LIVE_TEST_TIMEOUT,
  );

  it(
    "edits a previously generated image",
    async () => {
      const service = createLiveService();

      liveModelCallCount += 1;
      const generated: ImageGenerationResult = await runPacedLiveRequest(() =>
        service.generate({
          prompt: "A plain ceramic mug on a wooden table, studio lighting",
          width: LIVE_IMAGE_WIDTH,
          height: LIVE_IMAGE_HEIGHT,
        }),
      );
      expect(generated.success).toBe(true);
      if (!generated.success) return;

      liveModelCallCount += 1;
      const result: ImageGenerationResult = await runPacedLiveRequest(() =>
        service.edit({
          prompt: "Fill the mug with steaming coffee and add soft morning light",
          imageUrl: generated.url,
          width: LIVE_IMAGE_WIDTH,
          height: LIVE_IMAGE_HEIGHT,
        }),
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      await assertLiveImageUrl(result.url);
      generatedUrls.push({ label: "edit-of-generated", url: result.url });
      console.info(`[image-gen live e2e] edit-of-generated: ${result.url}`);
    },
    LIVE_TEST_TIMEOUT,
  );

  it(
    "edits a remote image URL",
    async () => {
      const service = createLiveService();
      liveModelCallCount += 1;
      const result: ImageGenerationResult = await runPacedLiveRequest(() =>
        service.edit({
          prompt: "Turn this into a vibrant watercolor painting",
          imageUrl: REMOTE_EDIT_IMAGE_URL,
          width: LIVE_IMAGE_WIDTH,
          height: LIVE_IMAGE_HEIGHT,
        }),
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      await assertLiveImageUrl(result.url);
      generatedUrls.push({ label: "edit-remote-url", url: result.url });
      console.info(`[image-gen live e2e] edit-remote-url: ${result.url}`);
    },
    LIVE_TEST_TIMEOUT,
  );

  afterAll(() => {
    if (generatedUrls.length === 0) {
      console.log("\n[image-gen live e2e] no image URLs were generated.\n");
      return;
    }
    console.log("\n[image-gen live e2e] generated image URLs:");
    for (const entry of generatedUrls) {
      console.log(`  ${entry.label}: ${entry.url}`);
    }
    console.log(
      `[image-gen live e2e] ${liveModelCallCount} live model call${
        liveModelCallCount === 1 ? "" : "s"
      } were executed.\n`,
    );
  });
});
