import type { ComponentInstance, ErrorUpdate, UiUpdate } from "./types.ts";

/**
 * The wire shape of an A2UI validation error envelope. Emitted in lenient
 * mode in place of a rejected UI update so the stream never crashes the
 * surface; the renderer decides how to display the diagnostic.
 */
export type A2UIValidationErrorCode =
  | "invalid_json"
  | "invalid_model_output"
  | "invalid_payload"
  | "payload_too_large"
  | "string_too_long"
  | "invalid_envelope"
  | "unknown_component"
  | "invalid_component_props"
  | "missing_props"
  | "missing_root"
  | "missing_root_element"
  | "missing_child"
  | "self_reference"
  | "cyclic_reference"
  | "duplicate_id"
  | "unreachable_element"
  | "too_many_components"
  | "empty_components";

/**
 * A single structured diagnostic produced by the A2UI validator. Carries the
 * JSON path, a stable code, and a human-readable message — enough for a repair
 * pass to tell the model exactly what to fix.
 */
export type A2UIValidationError = {
  path: string;
  code: A2UIValidationErrorCode;
  message: string;
  surfaceId?: string;
};

export type A2UIValidationResult =
  | { ok: true; update: UiUpdate }
  | { ok: false; issues: A2UIValidationError[] };

export type A2UIComponentValidationResult =
  | { ok: true; instance: ComponentInstance }
  | { ok: false; issues: A2UIValidationError[] };

/**
 * Wraps a list of issues as a single error envelope that can be emitted in
 * place of the rejected update. Lenient mode substitutes this for the original.
 */
export function toErrorEnvelope(issues: A2UIValidationError[]): ErrorUpdate {
  const first = issues[0];
  if (!first) {
    return {
      type: "error",
      message: "UI update was rejected by the validator.",
    };
  }
  return {
    type: "error",
    message: first.message,
  };
}
