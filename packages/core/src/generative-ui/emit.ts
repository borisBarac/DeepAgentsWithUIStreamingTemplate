import type { A2UIValidationError, A2UIValidationResult } from "./errors.ts";
import { toErrorEnvelope } from "./errors.ts";
import type { ErrorUpdate, ModelUiOutput, UiUpdate } from "./types.ts";
import { validateModelUiOutput, validateUpdate } from "./validator.ts";

/**
 * The single chokepoint through which every v2 emit must flow.
 *
 * `strict: true`  — throws on validation failure. Use on the server where a
 *                   rejected update is a programmer error and the surface
 *                   should be torn down.
 * `strict: false` — returns an error envelope in place of the rejected
 *                   update. Use on the client where resilience beats
 *                   correctness.
 *
 * Both paths go through the same validator, so the only difference is the
 * failure policy. There is no other emit path — adding one is the bug.
 */
export type EmitOptions = {
  strict?: boolean;
};

export type SafeEmitResult =
  | { ok: true; update: UiUpdate }
  | { ok: false; envelope: ErrorUpdate; issues: A2UIValidationError[] };

/**
 * Validates and (in lenient mode) substitutes an error envelope for a rejected
 * update. The caller is responsible for actually sending the result down the
 * wire — this function is pure and side-effect-free so it can be unit-tested
 * in isolation.
 *
 * In strict mode, validation failures throw — the server interaction stream
 * catches and surfaces them. In lenient mode, the function always returns a
 * sendable value.
 */
export function safeEmit(update: unknown, options: EmitOptions = {}): SafeEmitResult {
  const result: A2UIValidationResult = validateUpdate(update);
  if (result.ok) {
    return { ok: true, update: result.update };
  }
  if (options.strict) {
    const first = result.issues[0];
    const err = new Error(
      first
        ? `A2UI validation failed: ${first.message} (path=${first.path}, code=${first.code})`
        : "A2UI validation failed.",
    );
    (err as Error & { issues: A2UIValidationError[] }).issues = result.issues;
    throw err;
  }
  const envelope = toErrorEnvelope(result.issues);
  return { ok: false, envelope, issues: result.issues };
}

/**
 * Validates a complete ModelUiOutput. Strict mode throws on rejection; lenient
 * mode returns one canonical host-owned error envelope for the rejected batch.
 */
export function safeEmitModelOutput(
  value: unknown,
  options: EmitOptions = {},
):
  | { ok: true; output: ModelUiOutput }
  | {
      ok: false;
      envelope: ErrorUpdate;
      issues: A2UIValidationError[];
    } {
  const result = validateModelUiOutput(value);
  if (result.ok) {
    return { ok: true, output: result.output };
  }
  if (options.strict) {
    const first = result.issues[0];
    const err = new Error(
      first
        ? `A2UI model-output validation failed: ${first.message} (path=${first.path}, code=${first.code})`
        : "A2UI model-output validation failed.",
    );
    (err as Error & { issues: A2UIValidationError[] }).issues = result.issues;
    throw err;
  }

  return { ok: false, envelope: toErrorEnvelope(result.issues), issues: result.issues };
}
