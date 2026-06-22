import { describe, expect, it } from "bun:test";
import {
  createImageGenerationService,
  type ImageGenerationEditRequest,
  type ImageGenerationGenerateRequest,
  type ImageGenerationProvider,
} from "../index.ts";

class RecordingProvider implements ImageGenerationProvider {
  public readonly generateRequests: ImageGenerationGenerateRequest[] = [];
  public readonly editRequests: ImageGenerationEditRequest[] = [];
  public generateResult: string | Error = "https://example.com/generated.png";
  public editResult: string | Error = "https://example.com/edited.png";

  public async generate(request: ImageGenerationGenerateRequest): Promise<string> {
    this.generateRequests.push(request);
    if (this.generateResult instanceof Error) throw this.generateResult;
    return this.generateResult;
  }

  public async edit(request: ImageGenerationEditRequest): Promise<string> {
    this.editRequests.push(request);
    if (this.editResult instanceof Error) throw this.editResult;
    return this.editResult;
  }
}

describe("ImageGenerationService", () => {
  it("generates and edits images through the provider", async () => {
    const provider = new RecordingProvider();
    const service = createImageGenerationService(provider);
    const controller = new AbortController();

    expect(await service.generate({ prompt: "A mountain", signal: controller.signal })).toEqual({
      success: true,
      url: "https://example.com/generated.png",
    });
    expect(
      await service.edit({
        prompt: "Add snow",
        imageUrl: "https://example.com/source.png",
        signal: controller.signal,
      }),
    ).toEqual({ success: true, url: "https://example.com/edited.png" });
    expect(provider.generateRequests[0]?.signal).toBe(controller.signal);
    expect(provider.editRequests[0]?.signal).toBe(controller.signal);
  });

  it("rejects invalid inputs without invoking the provider", async () => {
    const provider = new RecordingProvider();
    const service = createImageGenerationService(provider);

    expect(await service.generate({ prompt: " \n " })).toMatchObject({
      success: false,
      error: { code: "validation" },
    });
    expect(await service.edit({ prompt: "Edit", imageUrl: "not a url" })).toMatchObject({
      success: false,
      error: { code: "validation" },
    });
    expect(provider.generateRequests).toHaveLength(0);
    expect(provider.editRequests).toHaveLength(0);
  });

  it("does not invoke the provider for an already-aborted request", async () => {
    const provider = new RecordingProvider();
    const service = createImageGenerationService(provider);
    const controller = new AbortController();
    controller.abort();

    expect(
      await service.generate({ prompt: "A mountain", signal: controller.signal }),
    ).toMatchObject({
      success: false,
      error: { code: "canceled" },
    });
    expect(provider.generateRequests).toHaveLength(0);
  });

  it("maps synchronous throws and rejected promises to provider errors", async () => {
    const syncProvider: ImageGenerationProvider = {
      generate() {
        throw new Error("sync failure");
      },
      edit: async () => "https://example.com/edit.png",
    };
    const rejectedProvider: ImageGenerationProvider = {
      generate: async () => Promise.reject(new Error("async failure")),
      edit: async () => "https://example.com/edit.png",
    };

    expect(
      await createImageGenerationService(syncProvider).generate({ prompt: "go" }),
    ).toMatchObject({
      success: false,
      error: { code: "provider", message: "sync failure" },
    });
    expect(
      await createImageGenerationService(rejectedProvider).generate({ prompt: "go" }),
    ).toMatchObject({
      success: false,
      error: { code: "provider", message: "async failure" },
    });
  });

  it("maps malformed provider output to an internal error", async () => {
    const provider = new RecordingProvider();
    provider.generateResult = "not a url";

    expect(
      await createImageGenerationService(provider).generate({ prompt: "A mountain" }),
    ).toMatchObject({
      success: false,
      error: { code: "internal" },
    });
  });

  it("reports cancellation when an in-flight request aborts", async () => {
    const provider: ImageGenerationProvider = {
      generate: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      edit: async () => "https://example.com/edit.png",
    };
    const service = createImageGenerationService(provider);
    const controller = new AbortController();
    const pending = service.generate({ prompt: "A mountain", signal: controller.signal });
    controller.abort();

    expect(await pending).toMatchObject({
      success: false,
      error: { code: "canceled" },
    });
  });
});
