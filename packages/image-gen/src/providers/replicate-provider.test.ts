import { describe, expect, it } from "bun:test";
import {
  DEFAULT_REPLICATE_EDIT_MODEL,
  DEFAULT_REPLICATE_GENERATION_MODEL,
  type ReplicateCompatibleClient,
  ReplicateImageGenerationProvider,
} from "./replicate-provider.ts";

describe("ReplicateImageGenerationProvider", () => {
  it("uses default models, exact inputs, and the supplied signal", async () => {
    const calls: Array<{ model: string; options: { input: object; signal?: AbortSignal } }> = [];
    const client: ReplicateCompatibleClient = {
      async run(model, options) {
        calls.push({ model, options });
        return ["https://example.com/output.png"];
      },
    };
    const provider = new ReplicateImageGenerationProvider({ client });
    const controller = new AbortController();

    await provider.generate({ prompt: "Generate", signal: controller.signal });
    await provider.edit({
      prompt: "Edit",
      imageUrl: "https://example.com/input.png",
      signal: controller.signal,
    });

    expect(calls).toEqual([
      {
        model: DEFAULT_REPLICATE_GENERATION_MODEL,
        options: { input: { prompt: "Generate" }, signal: controller.signal },
      },
      {
        model: DEFAULT_REPLICATE_EDIT_MODEL,
        options: {
          input: { prompt: "Edit", input_image: "https://example.com/input.png" },
          signal: controller.signal,
        },
      },
    ]);
  });

  it("supports model overrides and FileOutput values", async () => {
    const models: string[] = [];
    const client: ReplicateCompatibleClient = {
      async run(model) {
        models.push(model);
        return [{ url: () => new URL("https://example.com/file-output.png") }];
      },
    };
    const provider = new ReplicateImageGenerationProvider({
      client,
      generationModel: "owner/generate",
      editModel: "owner/edit:version",
    });

    expect(await provider.generate({ prompt: "Generate" })).toBe(
      "https://example.com/file-output.png",
    );
    expect(await provider.edit({ prompt: "Edit", imageUrl: "https://example.com/input.png" })).toBe(
      "https://example.com/file-output.png",
    );
    expect(models).toEqual(["owner/generate", "owner/edit:version"]);
  });

  const invalidOutputs: Array<[unknown]> = [[[]], [[""]], [["invalid"]], [[{}]]];

  it.each(invalidOutputs)("rejects empty or invalid output %#", async (output) => {
    const client: ReplicateCompatibleClient = { run: async () => output };
    const provider = new ReplicateImageGenerationProvider({ client });

    expect(provider.generate({ prompt: "Generate" })).rejects.toBeInstanceOf(Error);
  });

  it("preserves SDK rejections", async () => {
    const failure = new Error("SDK failed");
    const client: ReplicateCompatibleClient = {
      run: async () => Promise.reject(failure),
    };

    expect(
      new ReplicateImageGenerationProvider({ client }).generate({ prompt: "Generate" }),
    ).rejects.toBe(failure);
  });
});
