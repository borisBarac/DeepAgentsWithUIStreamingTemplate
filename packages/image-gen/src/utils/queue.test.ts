import { describe, expect, it } from "bun:test";
import {
  createImageGenerationQueue,
  type ImageGenerationResult,
  type ImageGenerationServiceContract,
  imageGenerationCanceled,
  imageGenerationError,
  imageGenerationSuccess,
} from "../index.ts";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  if (resolve === undefined) throw new Error("Deferred initialization failed.");
  return { promise, resolve };
}

class ControlledService implements ImageGenerationServiceContract {
  public readonly starts: string[] = [];
  public readonly pending: Array<{
    prompt: string;
    signal?: AbortSignal;
    deferred: Deferred<ImageGenerationResult>;
  }> = [];
  public active = 0;
  public maxActive = 0;

  public generate(request: {
    prompt: string;
    signal?: AbortSignal;
  }): Promise<ImageGenerationResult> {
    return this.start(request.prompt, request.signal);
  }

  public edit(request: {
    prompt: string;
    imageUrl: string;
    signal?: AbortSignal;
  }): Promise<ImageGenerationResult> {
    return this.start(`edit:${request.prompt}:${request.imageUrl}`, request.signal);
  }

  private start(prompt: string, signal?: AbortSignal): Promise<ImageGenerationResult> {
    this.starts.push(prompt);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    const operation = deferred<ImageGenerationResult>();
    this.pending.push({ prompt, signal, deferred: operation });
    signal?.addEventListener("abort", () => operation.resolve(imageGenerationCanceled()), {
      once: true,
    });
    return operation.promise.finally(() => {
      this.active -= 1;
    });
  }
}

function successfulHandle(
  result: ReturnType<ReturnType<typeof createImageGenerationQueue>["enqueue"]>,
) {
  if (!result.success) throw new Error("Expected enqueue success.");
  return result;
}

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ImageGenerationQueue", () => {
  it("rejects invalid requests before assigning IDs or invoking the service", () => {
    const service = new ControlledService();
    const queue = createImageGenerationQueue(service, { concurrencyLimit: 1 });

    expect(queue.enqueue({ type: "generate", prompt: " " })).toMatchObject({
      success: false,
      error: { code: "validation" },
    });
    expect(queue.enqueue({ type: "edit", prompt: "Edit", imageUrl: "not a url" })).toMatchObject({
      success: false,
      error: { code: "validation" },
    });
    expect(service.starts).toHaveLength(0);
    expect(queue.getStatus().retained).toBe(0);
  });

  it("bounds concurrency and starts mixed operations in FIFO order", async () => {
    const service = new ControlledService();
    const queue = createImageGenerationQueue(service, { concurrencyLimit: 2 });
    const first = successfulHandle(queue.enqueue({ type: "generate", prompt: "one" }));
    const second = successfulHandle(
      queue.enqueue({
        type: "edit",
        prompt: "two",
        imageUrl: "https://example.com/source.png",
      }),
    );
    const third = successfulHandle(queue.enqueue({ type: "generate", prompt: "three" }));

    expect(service.starts).toEqual(["one", "edit:two:https://example.com/source.png"]);
    expect(service.maxActive).toBe(2);
    expect(queue.getStatus()).toMatchObject({ active: 2, queued: 1, waiting: 1 });

    service.pending[0]?.deferred.resolve(imageGenerationSuccess("https://example.com/one.png"));
    await first.completion;
    await tick();
    expect(service.starts).toEqual(["one", "edit:two:https://example.com/source.png", "three"]);

    service.pending[1]?.deferred.resolve(imageGenerationSuccess("https://example.com/two.png"));
    service.pending[2]?.deferred.resolve(imageGenerationSuccess("https://example.com/three.png"));
    await Promise.all([second.completion, third.completion]);
    expect(service.maxActive).toBe(2);
  });

  it("returns immediate IDs and immutable lifecycle snapshots", async () => {
    const service = new ControlledService();
    const queue = createImageGenerationQueue(service, { concurrencyLimit: 1 });
    const handle = successfulHandle(
      queue.enqueue({ type: "generate", prompt: "one", metadata: { caller: "test" } }),
    );

    expect(handle.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const active = queue.getTask(handle.id);
    expect(active).toMatchObject({
      id: handle.id,
      status: "active",
      request: { id: handle.id, metadata: { caller: "test" } },
    });
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen(active?.request)).toBe(true);
    expect(Object.isFrozen(active?.request.metadata)).toBe(true);

    service.pending[0]?.deferred.resolve(imageGenerationSuccess("https://example.com/one.png"));
    await handle.completion;
    expect(queue.getTask(handle.id)?.status).toBe("succeeded");
  });

  it("rejects retained duplicate IDs and reuses them after history eviction", async () => {
    const service: ImageGenerationServiceContract = {
      generate: async () => imageGenerationSuccess("https://example.com/output.png"),
      edit: async () => imageGenerationSuccess("https://example.com/output.png"),
    };
    const queue = createImageGenerationQueue(service, { concurrencyLimit: 1, historyLimit: 1 });
    const first = successfulHandle(queue.enqueue({ id: "same", type: "generate", prompt: "one" }));
    await first.completion;
    expect(queue.enqueue({ id: "same", type: "generate", prompt: "duplicate" })).toMatchObject({
      success: false,
      error: { code: "validation" },
    });

    await successfulHandle(queue.enqueue({ id: "other", type: "generate", prompt: "other" }))
      .completion;
    expect(queue.getTask("same")).toBeUndefined();
    expect(queue.enqueue({ id: "same", type: "generate", prompt: "reused" }).success).toBe(true);
  });

  it("cancels waiting tasks immediately and idempotently", async () => {
    const service = new ControlledService();
    const queue = createImageGenerationQueue(service, { concurrencyLimit: 1 });
    const active = successfulHandle(queue.enqueue({ type: "generate", prompt: "active" }));
    const waiting = successfulHandle(queue.enqueue({ type: "generate", prompt: "waiting" }));

    expect(queue.cancel(waiting.id)).toEqual({ changed: true, status: "canceled" });
    expect(queue.cancel(waiting.id)).toEqual({ changed: false, status: "canceled" });
    expect(await waiting.completion).toMatchObject({
      success: false,
      error: { code: "canceled" },
    });
    expect(service.starts).toEqual(["active"]);
    expect(queue.getStatus()).toMatchObject({ active: 1, queued: 0, canceled: 1 });

    service.pending[0]?.deferred.resolve(imageGenerationSuccess("https://example.com/active.png"));
    await active.completion;
  });

  it("aborts active tasks and releases their slot only after settlement", async () => {
    const service = new ControlledService();
    const queue = createImageGenerationQueue(service, { concurrencyLimit: 1 });
    const first = successfulHandle(queue.enqueue({ type: "generate", prompt: "one" }));
    const second = successfulHandle(queue.enqueue({ type: "generate", prompt: "two" }));
    const signal = service.pending[0]?.signal;

    expect(queue.cancel(first.id)).toEqual({ changed: true, status: "active" });
    expect(signal?.aborted).toBe(true);
    expect(queue.cancel(first.id)).toEqual({ changed: false, status: "active" });
    await first.completion;
    await tick();
    expect(service.starts).toEqual(["one", "two"]);
    expect(queue.getTask(first.id)?.status).toBe("canceled");

    service.pending[1]?.deferred.resolve(imageGenerationSuccess("https://example.com/two.png"));
    await second.completion;
  });

  it("isolates failures and catches faulty service throws and rejections", async () => {
    let calls = 0;
    const service = {
      generate: ({ prompt }: { prompt: string }) => {
        calls += 1;
        if (prompt === "throw") throw new Error("broken sync");
        if (prompt === "reject") return Promise.reject(new Error("broken async"));
        return Promise.resolve(imageGenerationSuccess("https://example.com/ok.png"));
      },
      edit: async () => imageGenerationError("provider", "provider failed"),
    } satisfies ImageGenerationServiceContract;
    const queue = createImageGenerationQueue(service, { concurrencyLimit: 1 });
    const sync = successfulHandle(queue.enqueue({ type: "generate", prompt: "throw" }));
    const async = successfulHandle(queue.enqueue({ type: "generate", prompt: "reject" }));
    const provider = successfulHandle(
      queue.enqueue({
        type: "edit",
        prompt: "edit",
        imageUrl: "https://example.com/source.png",
      }),
    );
    const success = successfulHandle(queue.enqueue({ type: "generate", prompt: "ok" }));

    expect(await sync.completion).toMatchObject({
      success: false,
      error: { code: "internal" },
    });
    expect(await async.completion).toMatchObject({
      success: false,
      error: { code: "internal" },
    });
    expect(await provider.completion).toMatchObject({
      success: false,
      error: { code: "provider" },
    });
    expect(await success.completion).toEqual(imageGenerationSuccess("https://example.com/ok.png"));
    expect(calls).toBe(3);
    expect(queue.getStatus()).toMatchObject({ active: 0, failed: 3, succeeded: 1 });
  });

  it("normalizes malformed service results and keeps scheduling", async () => {
    const service = {
      generate: ({ prompt }: { prompt: string }) =>
        prompt === "bad"
          ? Promise.resolve(undefined as unknown as ImageGenerationResult)
          : Promise.resolve(imageGenerationSuccess("https://example.com/ok.png")),
      edit: async () => imageGenerationSuccess("https://example.com/edit.png"),
    } satisfies ImageGenerationServiceContract;
    const queue = createImageGenerationQueue(service, { concurrencyLimit: 1 });
    const malformed = successfulHandle(queue.enqueue({ type: "generate", prompt: "bad" }));
    const success = successfulHandle(queue.enqueue({ type: "generate", prompt: "ok" }));

    expect(await malformed.completion).toMatchObject({
      success: false,
      error: { code: "internal" },
    });
    expect(await success.completion).toEqual(imageGenerationSuccess("https://example.com/ok.png"));
    expect(queue.getTask(malformed.id)?.status).toBe("failed");
    expect(queue.getTask(success.id)?.status).toBe("succeeded");
    expect(queue.getStatus()).toMatchObject({ active: 0, failed: 1, succeeded: 1 });
  });

  it("evicts terminal tasks in completion order", async () => {
    const service = new ControlledService();
    const queue = createImageGenerationQueue(service, { concurrencyLimit: 2, historyLimit: 1 });
    const first = successfulHandle(
      queue.enqueue({ id: "first", type: "generate", prompt: "first" }),
    );
    const second = successfulHandle(
      queue.enqueue({ id: "second", type: "generate", prompt: "second" }),
    );

    service.pending[1]?.deferred.resolve(imageGenerationSuccess("https://example.com/second.png"));
    await second.completion;
    service.pending[0]?.deferred.resolve(imageGenerationSuccess("https://example.com/first.png"));
    await first.completion;

    expect(queue.getTask("second")).toBeUndefined();
    expect(queue.getTask("first")?.status).toBe("succeeded");
    expect(queue.getStatus()).toMatchObject({ retained: 1, succeeded: 1 });
    expect(queue.cancel("missing")).toEqual({ changed: false, status: undefined });
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid concurrency limit %p", (concurrencyLimit) => {
    expect(() =>
      createImageGenerationQueue(new ControlledService(), {
        concurrencyLimit,
      }),
    ).toThrow(RangeError);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid history limit %p", (historyLimit) => {
    expect(() =>
      createImageGenerationQueue(new ControlledService(), {
        concurrencyLimit: 1,
        historyLimit,
      }),
    ).toThrow(RangeError);
  });
});
