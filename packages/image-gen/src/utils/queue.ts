import {
  errorMessage,
  imageGenerationCanceled,
  imageGenerationError,
  isImageGenerationResult,
  validateImageGenerationPrompt,
  validateImageGenerationUrl,
} from "../types/results.ts";
import type {
  ImageGenerationQueueCancelResult,
  ImageGenerationQueueEnqueueResult,
  ImageGenerationQueueRequest,
  ImageGenerationQueueStatus,
  ImageGenerationResult,
  ImageGenerationServiceContract,
  ImageGenerationTaskSnapshot,
  ImageGenerationTaskStatus,
} from "../types/types.ts";

export const DEFAULT_IMAGE_GENERATION_HISTORY_LIMIT = 1000;

export interface ImageGenerationQueueOptions {
  readonly concurrencyLimit: number;
  readonly historyLimit?: number;
}

interface TaskRecord {
  readonly id: string;
  readonly request: Readonly<ImageGenerationQueueRequest>;
  readonly completion: Promise<ImageGenerationResult>;
  readonly resolve: (result: ImageGenerationResult) => void;
  status: ImageGenerationTaskStatus;
  result?: ImageGenerationResult;
  controller?: AbortController;
  cancellationRequested: boolean;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function immutableRequest(
  request: ImageGenerationQueueRequest,
  id: string,
): Readonly<ImageGenerationQueueRequest> {
  const metadata =
    request.metadata === undefined ? undefined : Object.freeze({ ...request.metadata });
  if (request.type === "edit") {
    return Object.freeze({
      type: "edit",
      id,
      prompt: request.prompt,
      imageUrl: request.imageUrl,
      ...(metadata === undefined ? {} : { metadata }),
    });
  }
  return Object.freeze({
    type: "generate",
    id,
    prompt: request.prompt,
    ...(metadata === undefined ? {} : { metadata }),
  });
}

function normalizeServiceResult(result: unknown): ImageGenerationResult {
  if (isImageGenerationResult(result)) {
    return result;
  }

  return imageGenerationError(
    "internal",
    "The image generation service returned an invalid result.",
    { result },
  );
}

export class ImageGenerationQueue {
  readonly #service: ImageGenerationServiceContract;
  readonly #concurrencyLimit: number;
  readonly #historyLimit: number;
  readonly #tasks = new Map<string, TaskRecord>();
  readonly #waiting: TaskRecord[] = [];
  readonly #terminalOrder: string[] = [];
  #activeCount = 0;

  public constructor(
    service: ImageGenerationServiceContract,
    options: ImageGenerationQueueOptions,
  ) {
    assertPositiveInteger(options.concurrencyLimit, "concurrencyLimit");
    const historyLimit = options.historyLimit ?? DEFAULT_IMAGE_GENERATION_HISTORY_LIMIT;
    assertPositiveInteger(historyLimit, "historyLimit");
    this.#service = service;
    this.#concurrencyLimit = options.concurrencyLimit;
    this.#historyLimit = historyLimit;
  }

  public enqueue(request: ImageGenerationQueueRequest): ImageGenerationQueueEnqueueResult {
    const promptValidation = validateImageGenerationPrompt(request.prompt);
    if (promptValidation !== undefined) {
      return promptValidation;
    }
    if (request.type === "edit") {
      const urlValidation = validateImageGenerationUrl(request.imageUrl);
      if (urlValidation !== undefined) {
        return urlValidation;
      }
    }

    const id = request.id ?? this.#createId();
    if (this.#tasks.has(id)) {
      return imageGenerationError("validation", `Task ID "${id}" is already in use.`);
    }

    let resolveCompletion!: (result: ImageGenerationResult) => void;
    const completion = new Promise<ImageGenerationResult>((resolve) => {
      resolveCompletion = resolve;
    });

    const task: TaskRecord = {
      id,
      request: immutableRequest(request, id),
      completion,
      resolve: resolveCompletion,
      status: "queued",
      cancellationRequested: false,
    };
    this.#tasks.set(id, task);
    this.#waiting.push(task);
    this.#schedule();
    return Object.freeze({ success: true, id, completion });
  }

  public cancel(id: string): ImageGenerationQueueCancelResult {
    const task = this.#tasks.get(id);
    if (task === undefined || this.#isTerminal(task.status)) {
      return Object.freeze({ changed: false, status: task?.status });
    }
    if (task.cancellationRequested) {
      return Object.freeze({ changed: false, status: task.status });
    }

    task.cancellationRequested = true;
    if (task.status === "queued") {
      const index = this.#waiting.indexOf(task);
      if (index !== -1) {
        this.#waiting.splice(index, 1);
      }
      this.#settle(task, imageGenerationCanceled());
    } else {
      task.controller?.abort();
    }
    return Object.freeze({ changed: true, status: task.status });
  }

  public getTask(id: string): ImageGenerationTaskSnapshot | undefined {
    const task = this.#tasks.get(id);
    if (task === undefined) {
      return undefined;
    }
    return Object.freeze({
      id: task.id,
      request: task.request,
      status: task.status,
      ...(task.result === undefined ? {} : { result: task.result }),
    });
  }

  public getStatus(): ImageGenerationQueueStatus {
    let succeeded = 0;
    let failed = 0;
    let canceled = 0;
    for (const task of this.#tasks.values()) {
      if (task.status === "succeeded") succeeded += 1;
      if (task.status === "failed") failed += 1;
      if (task.status === "canceled") canceled += 1;
    }
    return Object.freeze({
      concurrencyLimit: this.#concurrencyLimit,
      historyLimit: this.#historyLimit,
      queued: this.#waiting.length,
      waiting: this.#waiting.length,
      active: this.#activeCount,
      succeeded,
      failed,
      canceled,
      retained: this.#tasks.size,
    });
  }

  #createId(): string {
    let id = crypto.randomUUID();
    while (this.#tasks.has(id)) {
      id = crypto.randomUUID();
    }
    return id;
  }

  #schedule(): void {
    while (this.#activeCount < this.#concurrencyLimit) {
      const task = this.#waiting.shift();
      if (task === undefined) {
        return;
      }
      task.status = "active";
      task.controller = new AbortController();
      this.#activeCount += 1;
      void this.#run(task);
    }
  }

  async #run(task: TaskRecord): Promise<void> {
    const signal = task.controller?.signal;
    let result: ImageGenerationResult;
    try {
      const serviceResult =
        task.request.type === "generate"
          ? await this.#service.generate({ prompt: task.request.prompt, signal })
          : await this.#service.edit({
              prompt: task.request.prompt,
              imageUrl: task.request.imageUrl,
              signal,
            });
      result = normalizeServiceResult(serviceResult);
      if (signal?.aborted === true) {
        result = imageGenerationCanceled();
      }
    } catch (cause) {
      result =
        signal?.aborted === true
          ? imageGenerationCanceled()
          : imageGenerationError(
              "internal",
              errorMessage(cause, "The image generation service failed unexpectedly."),
              cause,
            );
    } finally {
      this.#activeCount -= 1;
      task.controller = undefined;
    }

    this.#settle(task, result);
    this.#schedule();
  }

  #settle(task: TaskRecord, result: ImageGenerationResult): void {
    task.result = result;
    task.status = result.success
      ? "succeeded"
      : result.error.code === "canceled"
        ? "canceled"
        : "failed";
    task.resolve(result);
    this.#terminalOrder.push(task.id);
    this.#evictHistory();
  }

  #evictHistory(): void {
    while (this.#terminalOrder.length > this.#historyLimit) {
      const oldestId = this.#terminalOrder.shift();
      if (oldestId !== undefined) {
        this.#tasks.delete(oldestId);
      }
    }
  }

  #isTerminal(status: ImageGenerationTaskStatus): boolean {
    return status === "succeeded" || status === "failed" || status === "canceled";
  }
}

export function createImageGenerationQueue(
  service: ImageGenerationServiceContract,
  options: ImageGenerationQueueOptions,
): ImageGenerationQueue {
  return new ImageGenerationQueue(service, options);
}
