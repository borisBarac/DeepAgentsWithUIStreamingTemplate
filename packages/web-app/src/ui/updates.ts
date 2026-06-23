import { z } from "zod";

import { normalizeStreamingSpec } from "./normalize.ts";
import type { UiUpdate } from "./types.ts";

const rawMessageUpdateSchema = z.object({
  type: z.literal("message"),
  text: z.string(),
});

const rawErrorUpdateSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
});

const rawUiUpdateSchema = z.object({
  type: z.literal("ui"),
  spec: z.unknown(),
});

const rawUpdateSchema = z.discriminatedUnion("type", [
  rawMessageUpdateSchema,
  rawUiUpdateSchema,
  rawErrorUpdateSchema,
]);

export function normalizeUiUpdate(value: unknown): UiUpdate | null {
  const parsed = rawUpdateSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  if (parsed.data.type !== "ui") {
    return parsed.data;
  }

  const spec = normalizeStreamingSpec(parsed.data.spec);
  return spec ? { type: "ui", spec } : null;
}
