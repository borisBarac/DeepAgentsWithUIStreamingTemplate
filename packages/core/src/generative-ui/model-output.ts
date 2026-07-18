import { z } from "zod";
import envelopeJson from "../../schemas/envelope.json" with { type: "json" };

import { catalogLimits } from "./catalog.ts";
import type { ModelUiOutput, ModelUiUpdate } from "./types.ts";

type JsonSchemaInput = Parameters<typeof z.fromJSONSchema>[0];

function schemaFor(definition: "ModelUiOutput" | "ModelUiUpdate"): JsonSchemaInput {
  return {
    $schema: envelopeJson.$schema,
    $defs: envelopeJson.$defs,
    $ref: `#/$defs/${definition}`,
  } as unknown as JsonSchemaInput;
}

/**
 * A model-owned update. Host activity and error updates are deliberately not
 * part of this schema and can only be created by the application.
 */
export const modelUiUpdateSchema = z.fromJSONSchema(
  schemaFor("ModelUiUpdate"),
) as z.ZodType<ModelUiUpdate>;

/** The complete JSON object returned by a generative UI model call. */
export const modelUiOutputSchema = z.fromJSONSchema(
  schemaFor("ModelUiOutput"),
) as z.ZodType<ModelUiOutput>;

export type { ModelUiOutput, ModelUiUpdate } from "./types.ts";

/** Returns a locally validated model output object, or null when invalid. */
export function normalizeModelUiOutput(value: unknown): ModelUiOutput | null {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return null;
  }
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > catalogLimits.maxJsonBytes
  ) {
    return null;
  }
  const result = modelUiOutputSchema.safeParse(value);
  return result.success ? result.data : null;
}
