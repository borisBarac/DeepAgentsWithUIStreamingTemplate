import { VisibilityConditionSchema } from "@json-render/core";
import { z } from "zod";

const MODEL_UI_MAX_UPDATES = 32;
const MODEL_UI_MAX_ID_LENGTH = 128;
const MODEL_UI_MAX_TEXT_LENGTH = 4_000;
const MODEL_UI_MAX_PROMPT_LENGTH = 1_000;
const MODEL_UI_MAX_OPTION_LENGTH = 300;

const modelUiQuestionOptionSchema = z.union([
  z.string().min(1).max(MODEL_UI_MAX_OPTION_LENGTH),
  z
    .object({
      label: z.string().min(1).max(MODEL_UI_MAX_OPTION_LENGTH),
      description: z.string().max(MODEL_UI_MAX_PROMPT_LENGTH).optional(),
      recommended: z.boolean().optional(),
    })
    .strict(),
]);

const modelUiQuestionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string().min(1).max(MODEL_UI_MAX_ID_LENGTH),
      prompt: z.string().min(1).max(MODEL_UI_MAX_PROMPT_LENGTH),
      kind: z.literal("multiple_choice"),
      options: z.array(modelUiQuestionOptionSchema).min(2).max(4),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(MODEL_UI_MAX_ID_LENGTH),
      prompt: z.string().min(1).max(MODEL_UI_MAX_PROMPT_LENGTH),
      kind: z.literal("open_text"),
      placeholder: z.string().max(MODEL_UI_MAX_OPTION_LENGTH).optional(),
    })
    .strict(),
]);

const modelUiElementSchema = z
  .object({
    type: z.string().min(1).max(MODEL_UI_MAX_ID_LENGTH),
    props: z.record(z.string(), z.unknown()),
    children: z.array(z.string().min(1).max(MODEL_UI_MAX_ID_LENGTH)).max(64).optional(),
    visible: VisibilityConditionSchema.optional(),
  })
  .strict();

const modelUiSpecSchema = z
  .object({
    root: z.string().min(1).max(MODEL_UI_MAX_ID_LENGTH),
    elements: z.record(z.string(), modelUiElementSchema),
  })
  .strict();

/**
 * A model-owned update. Host activity and error updates are deliberately not
 * part of this schema and can only be created by the application.
 */
export const modelUiUpdateSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("message"),
      text: z.string().min(1).max(MODEL_UI_MAX_TEXT_LENGTH),
    })
    .strict(),
  z
    .object({
      type: z.literal("question"),
      question: modelUiQuestionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("ui"),
      spec: modelUiSpecSchema,
    })
    .strict(),
]);

/** The complete JSON object returned by a generative UI model call. */
export const modelUiOutputSchema = z
  .object({
    version: z.literal(1),
    updates: z.array(modelUiUpdateSchema).min(1).max(MODEL_UI_MAX_UPDATES),
  })
  .strict();

export type ModelUiUpdate = z.infer<typeof modelUiUpdateSchema>;

export type ModelUiOutput = z.infer<typeof modelUiOutputSchema>;

/** Returns a locally validated model output object, or null when invalid. */
export function normalizeModelUiOutput(value: unknown): ModelUiOutput | null {
  const result = modelUiOutputSchema.safeParse(value);
  return result.success ? result.data : null;
}
