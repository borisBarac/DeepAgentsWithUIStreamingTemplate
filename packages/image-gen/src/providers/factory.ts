import type { ImageGenerationProvider } from "../types/types.ts";
import { createFixedImageGenerationProvider } from "./fixed-provider.ts";
import {
  createReplicateImageGenerationProvider,
  type ReplicateCompatibleClient,
} from "./replicate-provider.ts";

export interface ImageGenerationProviderFactoryOptions {
  readonly useFake?: boolean;
  readonly fixedImageUrl?: string;
  readonly replicateClient?: ReplicateCompatibleClient;
  readonly generationModel?: `${string}/${string}` | `${string}/${string}:${string}`;
  readonly editModel?: `${string}/${string}` | `${string}/${string}:${string}`;
}

export function createImageGenerationProvider(
  options: ImageGenerationProviderFactoryOptions = {},
): ImageGenerationProvider {
  if (options.useFake !== false) {
    return createFixedImageGenerationProvider(
      options.fixedImageUrl === undefined ? undefined : { imageUrl: options.fixedImageUrl },
    );
  }

  if (options.replicateClient === undefined) {
    throw new TypeError("A Replicate-compatible client is required when useFake is false.");
  }

  return createReplicateImageGenerationProvider({
    client: options.replicateClient,
    ...(options.generationModel !== undefined && { generationModel: options.generationModel }),
    ...(options.editModel !== undefined && { editModel: options.editModel }),
  });
}
