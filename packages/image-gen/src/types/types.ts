export interface ImageGenerationGenerateRequest {
  prompt: string;
  width?: number;
  height?: number;
  signal?: AbortSignal;
}

export interface ImageGenerationEditRequest {
  prompt: string;
  imageUrl: string;
  width?: number;
  height?: number;
  signal?: AbortSignal;
}

export interface ImageGenerationProvider {
  generate(request: ImageGenerationGenerateRequest): Promise<string>;
  edit(request: ImageGenerationEditRequest): Promise<string>;
}

export type ImageGenerationErrorCode = "validation" | "canceled" | "provider" | "internal";

export interface ImageGenerationSuccess {
  readonly success: true;
  readonly url: string;
}

export interface ImageGenerationError {
  readonly success: false;
  readonly error: {
    readonly code: ImageGenerationErrorCode;
    readonly message: string;
    readonly details?: unknown;
  };
}

export type ImageGenerationResult = ImageGenerationSuccess | ImageGenerationError;

export interface ImageGenerationServiceContract {
  generate(request: ImageGenerationGenerateRequest): Promise<ImageGenerationResult>;
  edit(request: ImageGenerationEditRequest): Promise<ImageGenerationResult>;
}

export interface ImageGenerationQueueRequestBase {
  readonly id?: string;
  readonly prompt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ImageGenerationQueueGenerateRequest extends ImageGenerationQueueRequestBase {
  readonly type: "generate";
}

export interface ImageGenerationQueueEditRequest extends ImageGenerationQueueRequestBase {
  readonly type: "edit";
  readonly imageUrl: string;
}

export type ImageGenerationQueueRequest =
  | ImageGenerationQueueGenerateRequest
  | ImageGenerationQueueEditRequest;

export type ImageGenerationTaskStatus = "queued" | "active" | "succeeded" | "failed" | "canceled";

export interface ImageGenerationTaskSnapshot {
  readonly id: string;
  readonly request: Readonly<ImageGenerationQueueRequest>;
  readonly status: ImageGenerationTaskStatus;
  readonly result?: ImageGenerationResult;
}

export interface ImageGenerationQueueStatus {
  readonly concurrencyLimit: number;
  readonly historyLimit: number;
  readonly queued: number;
  readonly waiting: number;
  readonly active: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly canceled: number;
  readonly retained: number;
}

export interface ImageGenerationQueueHandle {
  readonly id: string;
  readonly completion: Promise<ImageGenerationResult>;
}

export type ImageGenerationQueueEnqueueResult =
  | (ImageGenerationQueueHandle & { readonly success: true })
  | ImageGenerationError;

export interface ImageGenerationQueueCancelResult {
  readonly changed: boolean;
  readonly status?: ImageGenerationTaskStatus;
}
