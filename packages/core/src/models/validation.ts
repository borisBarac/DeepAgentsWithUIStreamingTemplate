import {
  MODEL_ROLES,
  type ModelRole,
  OPENAI_COMPATIBLE_PROVIDER,
  OPENROUTER_PROVIDER,
} from "./constants.ts";
import type { ModelRuntimeConfig } from "./types.ts";

export function assertValidName(name: string, kind: string): void {
  if (name.trim() === "" || name !== name.trim()) {
    throw new Error(`${kind} names must be non-empty and cannot contain surrounding whitespace.`);
  }
}

export function validateBaseURL(connectionName: string, baseURL: string): void {
  try {
    const url = new URL(baseURL);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error(
      `OpenAI-compatible connection "${connectionName}" must provide a valid HTTP(S) baseURL.`,
    );
  }
}

export function validateRuntimeConfig(config: ModelRuntimeConfig): void {
  const connectionNames = Object.keys(config.connections);
  const profileNames = Object.keys(config.models);

  if (connectionNames.length === 0) {
    throw new Error("Model runtime requires at least one named connection.");
  }
  if (profileNames.length === 0) {
    throw new Error("Model runtime requires at least one named model profile.");
  }

  for (const name of connectionNames) {
    assertValidName(name, "Connection");
    const connection = config.connections[name];
    if (!connection) continue;
    const rawProvider = String(connection.provider);
    switch (connection.provider) {
      case OPENAI_COMPATIBLE_PROVIDER:
        validateBaseURL(name, connection.baseURL);
        break;
      case OPENROUTER_PROVIDER:
        break;
      default:
        throw new Error(`Connection "${name}" uses unsupported provider "${rawProvider}".`);
    }
  }

  for (const name of profileNames) {
    assertValidName(name, "Model profile");
    const profile = config.models[name];
    if (!profile) continue;
    if (profile.model.trim() === "") {
      throw new Error(`Model profile "${name}" must provide a non-empty model ID.`);
    }
    if (!config.connections[profile.connection]) {
      throw new Error(
        `Model profile "${name}" references unknown connection "${profile.connection}".`,
      );
    }
  }

  for (const [role, profileName] of Object.entries(config.assignments)) {
    if (role !== "default" && !MODEL_ROLES.includes(role as ModelRole)) {
      throw new Error(`Model assignment uses unknown role "${role}".`);
    }
    if (typeof profileName !== "string" || !config.models[profileName]) {
      throw new Error(
        `Model assignment "${role}" references unknown model profile "${String(profileName)}".`,
      );
    }
  }
}
