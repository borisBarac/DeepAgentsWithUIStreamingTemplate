import { tool } from "@langchain/core/tools";
import { z } from "zod";

import type {
  ImageGenerationErrorCode,
  ImageGenerationServiceContract,
} from "../../../image-gen/src/index.ts";

export const IMAGE_DESIGNER_TOOL_NAME = "generate_image";

export const imageDesignerErrorSchema = z.object({
  code: z.enum(["validation", "canceled", "provider", "internal"] satisfies [
    ImageGenerationErrorCode,
    ...ImageGenerationErrorCode[],
  ]),
  message: z.string().min(1),
});

export const imageDesignerToolInputSchema = z.object({
  prompt: z.string().min(1),
  imageUrl: z.string().url().optional(),
});

export const imageDesignerToolSuccessSchema = z.object({
  success: z.literal(true),
  imageUrl: z.string().url(),
});

export const imageDesignerToolFailureSchema = z.object({
  success: z.literal(false),
  error: imageDesignerErrorSchema,
});

export const imageDesignerToolResultSchema = z.union([
  imageDesignerToolSuccessSchema,
  imageDesignerToolFailureSchema,
]);

export const imageDesignerResponseSchema = z
  .object({
    designedPrompt: z.string().min(1),
    imageUrl: z.string().url().optional(),
    error: imageDesignerErrorSchema.optional(),
  })
  .refine((value) => (value.imageUrl ? !value.error : !!value.error), {
    message: "Image designer response must include exactly one of imageUrl or error.",
  });

export type ImageDesignerError = z.infer<typeof imageDesignerErrorSchema>;
export type ImageDesignerToolInput = z.infer<typeof imageDesignerToolInputSchema>;
export type ImageDesignerToolResult = z.infer<typeof imageDesignerToolResultSchema>;
export type ImageDesignerResponse = z.infer<typeof imageDesignerResponseSchema>;

export function createImageDesignerTool(service: ImageGenerationServiceContract) {
  return tool(
    async ({ prompt, imageUrl }: ImageDesignerToolInput): Promise<ImageDesignerToolResult> => {
      const result = imageUrl
        ? await service.edit({ prompt, imageUrl })
        : await service.generate({ prompt });

      if (result.success) {
        return {
          success: true,
          imageUrl: result.url,
        };
      }

      return {
        success: false,
        error: {
          code: result.error.code,
          message: result.error.message,
        },
      };
    },
    {
      name: IMAGE_DESIGNER_TOOL_NAME,
      description:
        "Generate a new image from a polished prompt, or edit an existing image when imageUrl is provided.",
      schema: imageDesignerToolInputSchema,
    },
  );
}
