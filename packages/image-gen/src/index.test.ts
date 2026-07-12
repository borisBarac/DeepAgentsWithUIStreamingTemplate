import { describe, expect, it } from "bun:test";
import * as imageGeneration from "./index.ts";

describe("package exports", () => {
  it("exports the supported runtime API", () => {
    expect(imageGeneration).toMatchObject({
      ImageGenerationService: expect.any(Function),
      ImageGenerationQueue: expect.any(Function),
      ReplicateImageGenerationProvider: expect.any(Function),
      FixedImageGenerationProvider: expect.any(Function),
      createImageGenerationService: expect.any(Function),
      createImageGenerationQueue: expect.any(Function),
      createReplicateImageGenerationProvider: expect.any(Function),
      createFixedImageGenerationProvider: expect.any(Function),
    });
  });
});
