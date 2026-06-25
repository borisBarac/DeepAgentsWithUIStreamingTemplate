import type { FileOutput } from "replicate";
import { isSyntacticUrl } from "../types/results.ts";
import type {
  ImageGenerationEditRequest,
  ImageGenerationGenerateRequest,
  ImageGenerationProvider,
} from "../types/types.ts";

export const DEFAULT_REPLICATE_GENERATION_MODEL = "black-forest-labs/flux-schnell";
export const DEFAULT_REPLICATE_EDIT_MODEL = "black-forest-labs/flux-kontext-pro";

export interface ReplicateCompatibleClient {
  run(
    model: `${string}/${string}` | `${string}/${string}:${string}`,
    options: {
      input: object;
      signal?: AbortSignal;
    },
  ): Promise<unknown>;
}

export interface ReplicateImageGenerationProviderOptions {
  readonly client: ReplicateCompatibleClient;
  readonly generationModel?: `${string}/${string}` | `${string}/${string}:${string}`;
  readonly editModel?: `${string}/${string}` | `${string}/${string}:${string}`;
}

function isFileOutput(value: unknown): value is Pick<FileOutput, "url"> {
  return (
    typeof value === "object" && value !== null && "url" in value && typeof value.url === "function"
  );
}

function normalizeOutput(output: unknown): string {
  const first = Array.isArray(output) ? output[0] : output;
  let url: string;
  if (typeof first === "string") {
    url = first;
  } else if (isFileOutput(first)) {
    url = String(first.url());
  } else {
    throw new Error("Replicate returned no image output.");
  }

  if (url.trim() === "" || !isSyntacticUrl(url)) {
    throw new Error("Replicate returned an invalid image URL.");
  }
  return url;
}

function createImageInput(
  request: ImageGenerationGenerateRequest | ImageGenerationEditRequest,
): Record<string, unknown> {
  return {
    prompt: request.prompt,
    ...(request.width !== undefined && { width: request.width }),
    ...(request.height !== undefined && { height: request.height }),
    ...("imageUrl" in request && { input_image: request.imageUrl }),
  };
}

export class ReplicateImageGenerationProvider implements ImageGenerationProvider {
  public readonly generationModel: `${string}/${string}` | `${string}/${string}:${string}`;
  public readonly editModel: `${string}/${string}` | `${string}/${string}:${string}`;
  readonly #client: ReplicateCompatibleClient;

  public constructor(options: ReplicateImageGenerationProviderOptions) {
    if (options?.client === undefined) {
      throw new TypeError("A Replicate-compatible client is required.");
    }
    this.#client = options.client;
    this.generationModel = options.generationModel ?? DEFAULT_REPLICATE_GENERATION_MODEL;
    this.editModel = options.editModel ?? DEFAULT_REPLICATE_EDIT_MODEL;
  }

  public async generate(request: ImageGenerationGenerateRequest): Promise<string> {
    const output = await this.#client.run(this.generationModel, {
      input: createImageInput(request),
      signal: request.signal,
    });
    return normalizeOutput(output);
  }

  public async edit(request: ImageGenerationEditRequest): Promise<string> {
    const output = await this.#client.run(this.editModel, {
      input: createImageInput(request),
      signal: request.signal,
    });
    return normalizeOutput(output);
  }
}

export function createReplicateImageGenerationProvider(
  options: ReplicateImageGenerationProviderOptions,
): ReplicateImageGenerationProvider {
  return new ReplicateImageGenerationProvider(options);
}
