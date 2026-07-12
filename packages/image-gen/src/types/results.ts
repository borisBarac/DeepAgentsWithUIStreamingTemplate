import type {
  ImageGenerationError,
  ImageGenerationErrorCode,
  ImageGenerationResult,
  ImageGenerationSuccess,
} from "./types.ts";

const IMAGE_GENERATION_ERROR_CODES = [
  "validation",
  "canceled",
  "provider",
  "internal",
] as const satisfies readonly ImageGenerationErrorCode[];

export function imageGenerationSuccess(url: string): ImageGenerationSuccess {
  return Object.freeze({ success: true, url });
}

export function imageGenerationError(
  code: ImageGenerationErrorCode,
  message: string,
  details?: unknown,
): ImageGenerationError {
  const error =
    details === undefined
      ? { code, message }
      : {
          code,
          message,
          details,
        };
  return Object.freeze({ success: false, error: Object.freeze(error) });
}

export function imageGenerationCanceled(
  message = "Image generation was canceled.",
): ImageGenerationError {
  return imageGenerationError("canceled", message);
}

export function isImageGenerationResult(value: unknown): value is ImageGenerationResult {
  if (typeof value !== "object" || value === null || !("success" in value)) {
    return false;
  }

  const candidate = value as {
    success: unknown;
    url?: unknown;
    error?: unknown;
  };

  if (candidate.success === true) {
    return typeof candidate.url === "string" && isSyntacticUrl(candidate.url);
  }

  if (candidate.success !== false) {
    return false;
  }

  const error = candidate.error;
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const errorCandidate = error as {
    code?: unknown;
    message?: unknown;
  };

  return (
    typeof errorCandidate.code === "string" &&
    IMAGE_GENERATION_ERROR_CODES.includes(errorCandidate.code as ImageGenerationErrorCode) &&
    typeof errorCandidate.message === "string"
  );
}

export function isSyntacticUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function validateImageGenerationPrompt(prompt: string): ImageGenerationError | undefined {
  if (prompt.trim() === "") {
    return imageGenerationError("validation", "Prompt must not be empty.");
  }
  return undefined;
}

export function validateImageGenerationUrl(value: string): ImageGenerationError | undefined {
  if (!isSyntacticUrl(value)) {
    return imageGenerationError("validation", "Image URL must be a valid URL.");
  }
  return undefined;
}

export function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== "" ? cause.message : fallback;
}
