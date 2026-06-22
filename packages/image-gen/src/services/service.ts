import {
  errorMessage,
  imageGenerationCanceled,
  imageGenerationError,
  imageGenerationSuccess,
  isSyntacticUrl,
  validateImageGenerationPrompt,
  validateImageGenerationUrl,
} from "../types/results.ts";
import type {
  ImageGenerationEditRequest,
  ImageGenerationGenerateRequest,
  ImageGenerationProvider,
  ImageGenerationResult,
  ImageGenerationServiceContract,
} from "../types/types.ts";

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export class ImageGenerationService implements ImageGenerationServiceContract {
  readonly #provider: ImageGenerationProvider;

  public constructor(provider: ImageGenerationProvider) {
    if (provider === null || typeof provider !== "object") {
      throw new TypeError("An image generation provider is required.");
    }
    this.#provider = provider;
  }

  public async generate(request: ImageGenerationGenerateRequest): Promise<ImageGenerationResult> {
    const validation = validateImageGenerationPrompt(request.prompt);
    if (validation !== undefined) {
      return validation;
    }
    return this.#execute(request.signal, () => this.#provider.generate(request));
  }

  public async edit(request: ImageGenerationEditRequest): Promise<ImageGenerationResult> {
    const validation = validateImageGenerationPrompt(request.prompt);
    if (validation !== undefined) {
      return validation;
    }
    const urlValidation = validateImageGenerationUrl(request.imageUrl);
    if (urlValidation !== undefined) {
      return urlValidation;
    }
    return this.#execute(request.signal, () => this.#provider.edit(request));
  }

  async #execute(signal: AbortSignal | undefined, invoke: () => Promise<string>) {
    if (isAborted(signal)) {
      return imageGenerationCanceled();
    }

    try {
      const url = await invoke();
      if (isAborted(signal)) {
        return imageGenerationCanceled();
      }
      if (typeof url !== "string" || !isSyntacticUrl(url)) {
        return imageGenerationError(
          "internal",
          "The image generation provider returned an invalid URL.",
          { output: url },
        );
      }
      return imageGenerationSuccess(url);
    } catch (cause) {
      if (isAborted(signal)) {
        return imageGenerationCanceled();
      }
      return imageGenerationError(
        "provider",
        errorMessage(cause, "The image generation provider failed."),
        cause,
      );
    }
  }
}

export function createImageGenerationService(
  provider: ImageGenerationProvider,
): ImageGenerationService {
  return new ImageGenerationService(provider);
}
