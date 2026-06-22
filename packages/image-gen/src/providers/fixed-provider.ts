import type {
  ImageGenerationEditRequest,
  ImageGenerationGenerateRequest,
  ImageGenerationProvider,
} from "../types/types.ts";

export const DEFAULT_FIXED_IMAGE_URL =
  "https://learn.zoner.com/wp-content/uploads/2025/04/zoner-ai-image-creator.jpg";

export interface FixedImageGenerationProviderOptions {
  imageUrl?: string;
}

export class FixedImageGenerationProvider implements ImageGenerationProvider {
  public readonly imageUrl: string;

  public constructor(options: FixedImageGenerationProviderOptions = {}) {
    this.imageUrl = options.imageUrl ?? DEFAULT_FIXED_IMAGE_URL;
  }

  public async generate(_request: ImageGenerationGenerateRequest): Promise<string> {
    return this.imageUrl;
  }

  public async edit(_request: ImageGenerationEditRequest): Promise<string> {
    return this.imageUrl;
  }
}

export function createFixedImageGenerationProvider(
  options: FixedImageGenerationProviderOptions = {},
): FixedImageGenerationProvider {
  return new FixedImageGenerationProvider(options);
}
