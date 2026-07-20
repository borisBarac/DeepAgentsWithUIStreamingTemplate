import type { HarnessProfile, HarnessProfileOptions } from "deepagents";
import { createHarnessProfile, getHarnessProfile, registerHarnessProfile } from "deepagents";

import { DEFAULT_GENERAL_PURPOSE_SYSTEM_PROMPT } from "../prompts/index.ts";

/**
 * The harness profile key this repo registers under. deepagents' resolver
 * looks profiles up by `"<provider>:<model>"` first, then falls back to the
 * bare provider prefix. Because {@link createRuntimeModel} produces
 * `ChatOpenAI` instances whose `model_name`/`modelName` are undefined (only
 * `model` is set on the instance), `getModelIdentifier(chatOpenAi)` returns
 * `undefined` and the resolver falls through to the bare-provider branch.
 * Registering under anything more specific (e.g. `"openai:deepseek-v4-flash"`)
 * would never be looked up.
 *
 * The consequence: there is **one global harness profile** for the entire
 * app. Per-role customization must continue to flow through `subagentOverrides`
 * (which the catalog honors directly). The harness profile is reserved for
 * app-wide ambient configuration: the prose-contract `systemPromptSuffix`, the
 * general-purpose subagent's prompt, and (rarely) tool/middleware shaping.
 */
export const AGENT_HARNESS_PROFILE_KEY = "openai";

/**
 * The default {@link HarnessProfileOptions} for this repo. Applied uniformly
 * to the main agent, declarative subagents, and the auto-added general-purpose
 * subagent.
 *
 * - `systemPromptSuffix`: a short prose-contract reminder appended (as a
 *   separate text block) to deepagents' `BASE_AGENT_PROMPT`. The supervisor's
 *   own prompt (from `packages/core/prompts/supervisor.md`) is unaffected —
 *   deepagents composes it as the first text block, and the suffix lands in
 *   the second block alongside `BASE_AGENT_PROMPT`.
 * - `generalPurposeSubagent.enabled`: disables deepagents' auto-added fallback
 *   subagent so every delegated task uses the explicit specialist catalog.
 *
 * Callers can override any field via the `profile` option on
 * {@link createScaffoldedAgent}. Scalar overrides replace; the GP prompt is a
 * scalar (string), so caller-supplied prompts fully replace the default.
 */
export const DEFAULT_AGENT_PROFILE: HarnessProfileOptions = {
  systemPromptSuffix:
    "Respond in prose unless a tool schema requires JSON. Never wrap prose output in fenced code blocks.",
  generalPurposeSubagent: {
    enabled: false,
    systemPrompt: DEFAULT_GENERAL_PURPOSE_SYSTEM_PROMPT,
  },
};

/**
 * Merge a caller-supplied {@link HarnessProfileOptions} on top of
 * {@link DEFAULT_AGENT_PROFILE} and return a frozen {@link HarnessProfile}.
 * Caller scalars win; the GP subagent config is shallow-merged so callers can
 * override individual fields (e.g. just `systemPromptSuffix`, leaving the GP
 * prompt on the default).
 */
export function createAgentHarnessProfile(overrides?: HarnessProfileOptions): HarnessProfile {
  if (!overrides) return createHarnessProfile(DEFAULT_AGENT_PROFILE);
  const mergedGeneralPurpose = {
    ...DEFAULT_AGENT_PROFILE.generalPurposeSubagent,
    ...overrides.generalPurposeSubagent,
  };
  return createHarnessProfile({
    ...DEFAULT_AGENT_PROFILE,
    ...overrides,
    generalPurposeSubagent: mergedGeneralPurpose,
  });
}

let defaultProfileRegistered = false;

/**
 * Register {@link DEFAULT_AGENT_PROFILE} under {@link AGENT_HARNESS_PROFILE_KEY}
 * so deepagents' {@link createDeepAgent} resolver picks it up. Idempotent —
 * the first call registers; subsequent calls are no-ops.
 *
 * Safe to call from tests; the registration is global per the underlying
 * deepagents registry (keyed on `Symbol.for("deepagents.harness-profiles.v1")`).
 * Use {@link clearHarnessProfileRegistry} in `afterEach` to keep tests isolated.
 */
export function ensureDefaultAgentProfileRegistered(): void {
  if (defaultProfileRegistered) return;
  registerHarnessProfile(AGENT_HARNESS_PROFILE_KEY, DEFAULT_AGENT_PROFILE);
  defaultProfileRegistered = true;
}

/**
 * Register a caller-supplied profile under {@link AGENT_HARNESS_PROFILE_KEY}.
 * Use this from {@link createAgentFromRuntimeScaffold} when the caller passes
 * a `profile` override. Merges additively on top of any existing registration
 * (including the default installed by {@link ensureDefaultAgentProfileRegistered}).
 *
 * Returns the resolved {@link HarnessProfile} that `createDeepAgent` will see.
 */
export function registerAgentProfile(
  profile: HarnessProfile | HarnessProfileOptions,
): HarnessProfile {
  registerHarnessProfile(AGENT_HARNESS_PROFILE_KEY, profile);
  defaultProfileRegistered = true;
  const resolved = getHarnessProfile(AGENT_HARNESS_PROFILE_KEY);
  return resolved ?? createAgentHarnessProfile();
}

/**
 * The well-known symbol under which deepagents stores its global harness
 * profile registry. Exposed for test cleanup; production code must not touch
 * the registry directly.
 */
export const HARNESS_PROFILE_REGISTRY_SYMBOL = Symbol.for("deepagents.harness-profiles.v1");

/**
 * Test-only helper: remove the entry registered under
 * {@link AGENT_HARNESS_PROFILE_KEY} from deepagents' global registry, and
 * reset the module-level idempotency flag. Use in `afterEach` to keep tests
 * isolated.
 */
export function clearHarnessProfileRegistry(): void {
  defaultProfileRegistered = false;
  const registry = (globalThis as Record<symbol, { profiles: Map<string, unknown> } | undefined>)[
    HARNESS_PROFILE_REGISTRY_SYMBOL
  ];
  registry?.profiles?.delete(AGENT_HARNESS_PROFILE_KEY);
}
