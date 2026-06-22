import { describe, expect, it } from "bun:test";

import type {
  ImageGenerationEditRequest,
  ImageGenerationGenerateRequest,
} from "../../../image-gen/src/index.ts";
import {
  createImageDesignerTool,
  IMAGE_DESIGNER_TOOL_NAME,
  imageDesignerResponseSchema,
} from "./index.ts";

describe("image designer tool", () => {
  it("calls generate for fresh image requests", async () => {
    const calls: string[] = [];
    const tool = createImageDesignerTool({
      async generate(request: ImageGenerationGenerateRequest) {
        calls.push(`generate:${request.prompt}`);
        return { success: true, url: "https://example.com/generated.png" };
      },
      async edit() {
        throw new Error("edit should not be called");
      },
    });

    await expect(
      tool.invoke({ prompt: "A bright travel poster of Prague at sunrise." }),
    ).resolves.toEqual({
      success: true,
      imageUrl: "https://example.com/generated.png",
    });
    expect(calls).toEqual(["generate:A bright travel poster of Prague at sunrise."]);
    expect(tool.name).toBe(IMAGE_DESIGNER_TOOL_NAME);
  });

  it("calls edit when a source image URL is provided", async () => {
    const calls: string[] = [];
    const tool = createImageDesignerTool({
      async generate() {
        throw new Error("generate should not be called");
      },
      async edit(request: ImageGenerationEditRequest) {
        calls.push(`edit:${request.imageUrl}:${request.prompt}`);
        return { success: true, url: "https://example.com/edited.png" };
      },
    });

    await expect(
      tool.invoke({
        prompt:
          "Replace the background with a soft studio gradient and keep the subject unchanged.",
        imageUrl: "https://example.com/source.png",
      }),
    ).resolves.toEqual({
      success: true,
      imageUrl: "https://example.com/edited.png",
    });
    expect(calls).toEqual([
      "edit:https://example.com/source.png:Replace the background with a soft studio gradient and keep the subject unchanged.",
    ]);
  });

  it("normalizes provider failures without rethrowing", async () => {
    const tool = createImageDesignerTool({
      async generate() {
        return {
          success: false,
          error: {
            code: "provider",
            message: "Provider timed out.",
            details: { requestId: "abc123" },
          },
        };
      },
      async edit() {
        throw new Error("edit should not be called");
      },
    });

    await expect(tool.invoke({ prompt: "A cinematic portrait." })).resolves.toEqual({
      success: false,
      error: {
        code: "provider",
        message: "Provider timed out.",
      },
    });
  });
});

describe("image designer response schema", () => {
  it("accepts success and failure payloads with a designed prompt", () => {
    expect(
      imageDesignerResponseSchema.parse({
        designedPrompt: "A crisp editorial portrait with soft daylight and a neutral backdrop.",
        imageUrl: "https://example.com/final.png",
      }),
    ).toEqual({
      designedPrompt: "A crisp editorial portrait with soft daylight and a neutral backdrop.",
      imageUrl: "https://example.com/final.png",
    });

    expect(
      imageDesignerResponseSchema.parse({
        designedPrompt: "Keep the framing unchanged and swap the backdrop for a muted green wall.",
        error: {
          code: "validation",
          message: "Editing requires an absolute source image URL.",
        },
      }),
    ).toEqual({
      designedPrompt: "Keep the framing unchanged and swap the backdrop for a muted green wall.",
      error: {
        code: "validation",
        message: "Editing requires an absolute source image URL.",
      },
    });
  });
});
