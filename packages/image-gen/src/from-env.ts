import Replicate from "replicate";

import { createFixedImageGenerationProvider } from "./providers/fixed-provider.ts";
import {
  createReplicateImageGenerationProvider,
  type ReplicateCompatibleClient,
} from "./providers/replicate-provider.ts";
import { createImageGenerationService } from "./services/service.ts";
import type { ImageGenerationServiceContract } from "./types/types.ts";

const TRUE = "true";
const FALSE = "false";

export const USE_FAKE_IMAGE_PROVIDER_ENV = "USE_FAKE_IMAGE_PROVIDER";
export const REPLICATE_API_TOKEN_ENV = "REPLICATE_API_TOKEN";

export interface ImageGenerationServiceFromEnvOptions {
  readonly useFake?: boolean;
  readonly fixedImageUrl?: string;
  readonly replicateApiToken?: string;
  readonly replicateClient?: ReplicateCompatibleClient;
  readonly generationModel?: `${string}/${string}` | `${string}/${string}:${string}`;
  readonly editModel?: `${string}/${string}` | `${string}/${string}:${string}`;
}

function resolveUseFake(raw: string | undefined, override: boolean | undefined): boolean {
  if (override !== undefined) {
    return override;
  }
  const normalized = raw?.trim().toLowerCase();
  if (normalized === undefined || normalized === "") {
    return true;
  }
  if (normalized === TRUE) {
    return true;
  }
  if (normalized === FALSE) {
    return false;
  }
  throw new Error(`USE_FAKE_IMAGE_PROVIDER must be "true" or "false" (got "${raw}").`);
}

export function createImageGenerationServiceFromEnv(
  options: ImageGenerationServiceFromEnvOptions = {},
): ImageGenerationServiceContract {
  const useFake = resolveUseFake(process.env[USE_FAKE_IMAGE_PROVIDER_ENV], options.useFake);

  if (useFake) {
    const provider = createFixedImageGenerationProvider(
      options.fixedImageUrl === undefined ? undefined : { imageUrl: options.fixedImageUrl },
    );
    return createImageGenerationService(provider);
  }

  const token = options.replicateApiToken ?? process.env[REPLICATE_API_TOKEN_ENV]?.trim();
  const client =
    options.replicateClient ??
    (token ? (new Replicate({ auth: token }) as unknown as ReplicateCompatibleClient) : undefined);

  if (client === undefined) {
    throw new Error('USE_FAKE_IMAGE_PROVIDER="false" requires REPLICATE_API_TOKEN to be set.');
  }

  const provider = createReplicateImageGenerationProvider({
    client,
    ...(options.generationModel !== undefined && { generationModel: options.generationModel }),
    ...(options.editModel !== undefined && { editModel: options.editModel }),
  });
  return createImageGenerationService(provider);
}
